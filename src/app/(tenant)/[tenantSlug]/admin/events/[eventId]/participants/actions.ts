'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { logQueryError } from '@/lib/db/query-error'
import { translateDbError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { fetchParticipants } from '@/lib/race-results/client'
import { parseRaceResultsEventId } from '@/lib/race-results/parse-url'
import { hasFeature } from '@/lib/tiers/features'
import type { Json } from '@/types/database'
import { adminEventRoutePattern } from '@/lib/events/paths'
import { resolveRequestEventId } from '@/lib/events/request-event'

const tenantIdSchema = z.string().uuid()
const stageIdSchema = z.string().uuid()

/**
 * Access check shared by every action here.
 *
 * TWO GATES, NOT ONE. `hasAdminAccessToTenant` answers "may this user
 * administer this tenant"; `hasFeature(..., 'participants')` answers "does
 * this tenant's plan include participants at all". N21 is Premium and up,
 * and unlike N18's read-only mobile schedule it MUTATES — so the tier
 * cannot be enforced only by hiding the page. A Standard tenant's admin
 * could otherwise post straight at these actions.
 *
 * The tier is read from the database rather than taken from the caller,
 * for the same reason updateTenantColorPalette reads it: it governs
 * access, so it must not come from the client.
 */
async function authorize(
  tenantId: string
): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>; tenantId: string }
  | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(tenantId)
  if (!parsedTenantId.success) {
    logger.warn('participants action: invalid tenantId', { tenantId })
    return { ok: false, error: await tError('actionErrors.notAuthorized') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data))) {
    return { ok: false, error: await tError('actionErrors.notAuthorized') }
  }

  const { data: tierRow, error: tierError } = await supabase
    .from('tenants')
    .select('tier')
    .eq('id', parsedTenantId.data)
    .maybeSingle()

  if (tierError) {
    return {
      ok: false,
      error: await translateDbError('participants action: tier lookup failed', tierError),
    }
  }

  if (!tierRow || !hasFeature(tierRow.tier, 'participants')) {
    logger.warn('participants action: tier does not include participants', {
      tenantId: parsedTenantId.data,
      tier: tierRow?.tier,
    })
    return { ok: false, error: await tError('actionErrors.participantsNotInTier') }
  }

  return { ok: true, supabase, tenantId: parsedTenantId.data }
}

/** What one stage's import run did, or why it could not run. */
export interface StageImportOutcome {
  stageId: string
  stageName: string
  ok: boolean
  /** Already translated; safe to render. */
  error?: string
  inserted?: number
  updated?: number
  withdrawn?: number
  revived?: number
  /** Rows the API returned without a usable ID. Never silently dropped. */
  skipped?: number
}

export interface ImportParticipantsResult {
  error?: string
  outcomes?: StageImportOutcome[]
}

/**
 * Import the participant list for one or more Race stages.
 *
 * ONE STAGE AT A TIME, deliberately. Each stage is a separate request to
 * an undocumented third-party API (spike §6); if stage 3 of 6 times out,
 * the first two must stay imported rather than being rolled back with it.
 * The RPC's transaction boundary is the stage, and this loop reports per
 * stage so the admin can see exactly which ones landed.
 */
export async function importParticipants(input: {
  tenantSlug: string
  tenantId: string
  stageIds: string[]
}): Promise<ImportParticipantsResult> {
  const auth = await authorize(input.tenantId)
  if (!auth.ok) return { error: auth.error }
  const { supabase, tenantId } = auth

  const stageIds = input.stageIds.filter((id) => stageIdSchema.safeParse(id).success)
  if (stageIds.length === 0) {
    return { error: await tError('actionErrors.noStagesSelected') }
  }

  // Read the stages' own results_url rather than trusting anything from
  // the client: the link is the import's source, so a caller must not be
  // able to point it somewhere else. Scoped by tenant_id so a stage id
  // from another tenant simply does not come back.
  const { data: stages, error: stagesError } = await supabase
    .from('event_stages')
    .select('id, name, results_url')
    .eq('tenant_id', tenantId)
    .in('id', stageIds)

  if (stagesError) {
    logQueryError(stagesError, {
      op: 'importParticipants',
      table: 'event_stages',
      kind: 'select',
      tenantId,
    })
    return { error: await translateDbError('importParticipants: stage lookup', stagesError) }
  }

  if (!stages || stages.length === 0) {
    return { error: await tError('actionErrors.noStagesSelected') }
  }

  const outcomes: StageImportOutcome[] = []

  for (const stage of stages) {
    // A stage whose link an admin has not filled in yet. Said plainly per
    // stage rather than failing the whole run: with several stages
    // selected, the others can still import.
    const eventId = parseRaceResultsEventId(stage.results_url)
    if (!eventId) {
      outcomes.push({
        stageId: stage.id,
        stageName: stage.name,
        ok: false,
        error: await tError('actionErrors.participantsNoResultsLink'),
      })
      continue
    }

    const fetched = await fetchParticipants(eventId)
    if (!fetched.ok) {
      // The English `message` goes to the log, never to the admin.
      logger.warn('importParticipants: Race Results fetch failed', {
        tenantId,
        stageId: stage.id,
        kind: fetched.kind,
        message: fetched.message,
      })
      outcomes.push({
        stageId: stage.id,
        stageName: stage.name,
        ok: false,
        error: await tError(`actionErrors.participantsFetch_${fetched.kind}`),
      })
      continue
    }

    const rows = fetched.participants.map((p) => ({
      external_id: p.externalId,
      name: p.name,
      bib: p.bib,
      category: p.category,
      club: p.club,
      nation: p.nation,
      gender: p.gender,
      extra: p.extra,
    }))

    const { data, error: rpcError } = await supabase.rpc('import_participants', {
      p_tenant_id: tenantId,
      p_stage_id: stage.id,
      p_rows: rows as unknown as Json,
    })

    if (rpcError) {
      outcomes.push({
        stageId: stage.id,
        stageName: stage.name,
        ok: false,
        error: await translateDbError(
          'importParticipants: import_participants failed',
          rpcError,
          'participants.import.genericError'
        ),
      })
      continue
    }

    // The RPC returns jsonb, so the generated type is `Json` and these keys
    // are not type-checked (F-REL-16). The shape is asserted by
    // tests/integration/import-participants.test.ts against real Postgres.
    const counts = (data ?? {}) as unknown as {
      inserted?: number
      updated?: number
      withdrawn?: number
      revived?: number
    }

    outcomes.push({
      stageId: stage.id,
      stageName: stage.name,
      ok: true,
      inserted: counts.inserted ?? 0,
      updated: counts.updated ?? 0,
      withdrawn: counts.withdrawn ?? 0,
      revived: counts.revived ?? 0,
      skipped: fetched.skipped,
    })
  }

  revalidatePath(adminEventRoutePattern('participants'), 'page')

  return { outcomes }
}

const addParticipantSchema = z.object({
  name: z.string().trim().min(1).max(200),
  bib: z.string().trim().max(50).optional(),
  category: z.string().trim().max(100).optional(),
  club: z.string().trim().max(200).optional(),
  nation: z.string().trim().max(3).optional(),
  gender: z.string().trim().max(10).optional(),
  phone: z.string().trim().max(32).optional(),
})

export interface AddParticipantResult {
  error?: string
}

/**
 * Add one participant by hand.
 *
 * `source` is left at its 'manual' default and `external_id` stays NULL —
 * together that is what keeps an import from ever adopting, updating or
 * withdrawing this row (the card's "Manual entries get a separate ID
 * series"). The participants_external_id_matches_source constraint makes
 * the pairing impossible to get wrong from here.
 *
 * No SMS, unlike the officials invite this form otherwise resembles:
 * participants have no login yet, and an imported one has no phone number
 * to send to.
 */
export async function addParticipant(input: {
  tenantSlug: string
  tenantId: string
  /** N23: the event the participant is entered in. */
  eventId: string
  name: string
  bib?: string
  category?: string
  club?: string
  nation?: string
  gender?: string
  phone?: string
}): Promise<AddParticipantResult> {
  const auth = await authorize(input.tenantId)
  if (!auth.ok) return { error: auth.error }
  const { supabase, tenantId } = auth

  const parsed = addParticipantSchema.safeParse(input)
  if (!parsed.success) {
    return { error: await tError('actionErrors.invalidRequest') }
  }

  // N23: the event must be one of this tenant's, read through the caller's
  // RLS; the composite FK on participants refuses a foreign one regardless.
  const eventId = await resolveRequestEventId(supabase, tenantId, input.eventId)
  if (!eventId) return { error: await tError('actionErrors.invalidRequest') }

  const { error } = await supabase.from('participants').insert({
    tenant_id: tenantId,
    event_id: eventId,
    name: parsed.data.name,
    // Empty optional fields are stored as NULL rather than '': an empty
    // string would read as a known-blank value, and for phone it would be
    // a false answer to the lookups that key on it.
    bib: parsed.data.bib || null,
    category: parsed.data.category || null,
    club: parsed.data.club || null,
    nation: parsed.data.nation ? parsed.data.nation.toUpperCase() : null,
    gender: parsed.data.gender || null,
    phone: parsed.data.phone || null,
  })

  if (error) {
    return {
      error: await translateDbError(
        'addParticipant: insert failed',
        error,
        'participants.add.genericError'
      ),
    }
  }

  revalidatePath(adminEventRoutePattern('participants'), 'page')

  return {}
}

const participantIdSchema = z.string().uuid()

export interface ParticipantRowActionResult {
  error?: string
}

/**
 * Hide a participant from the roster, or show them again (N34).
 *
 * HIDE ONLY, per Peter on N26: the person is still entered and still
 * receives participant announcements — which is why nothing but the roster
 * query reads hidden_at.
 *
 * hidden_at, not withdrawn_at: the import clears withdrawn_at for everyone
 * in the Race Results response, so reusing it would let the next import
 * undo the admin's hide (migration 20261030091721). Works the same for
 * imported and manual rows.
 */
export async function setParticipantHidden(input: {
  tenantSlug: string
  tenantId: string
  eventId: string
  participantId: string
  hidden: boolean
}): Promise<ParticipantRowActionResult> {
  const auth = await authorize(input.tenantId)
  if (!auth.ok) return { error: auth.error }
  const { supabase, tenantId } = auth

  const participantId = participantIdSchema.safeParse(input.participantId)
  if (!participantId.success) return { error: await tError('actionErrors.invalidRequest') }

  const eventId = await resolveRequestEventId(supabase, tenantId, input.eventId)
  if (!eventId) return { error: await tError('actionErrors.invalidRequest') }

  // .select('id') so a row that did not match — another event's id, or one
  // RLS hides — comes back as zero rows instead of a silent success.
  const { data, error } = await supabase
    .from('participants')
    .update({ hidden_at: input.hidden ? new Date().toISOString() : null })
    .eq('id', participantId.data)
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .select('id')

  if (error) {
    return {
      error: await translateDbError(
        'setParticipantHidden: update failed',
        error,
        'participants.actions.genericError'
      ),
    }
  }

  if (!data || data.length === 0) {
    logger.warn('setParticipantHidden: no matching participant', {
      tenantId,
      eventId,
      participantId: participantId.data,
    })
    return { error: await tError('actionErrors.participantNotFound') }
  }

  revalidatePath(adminEventRoutePattern('participants'), 'page')

  return {}
}

/**
 * Remove a manually added participant (N34).
 *
 * MANUAL ONLY. Peter answered for hand-typed entries; the imported list is
 * Race Results' to own, and an imported row deleted here would simply come
 * back on the next import. The `source = 'manual'` filter is what enforces
 * that — an imported id matches no row and the caller gets "not found".
 *
 * A HARD DELETE, not a soft one. Hiding already covers "keep the row but
 * stop showing it"; a manual row being removed is a typo or someone who was
 * never entered, and nothing else points at it. Its participant_stages
 * links go with it (ON DELETE CASCADE, migration 20261026084206), and the
 * SMS queue stores phone numbers rather than participant ids, so an
 * announcement already sent is unaffected.
 */
export async function removeParticipant(input: {
  tenantSlug: string
  tenantId: string
  eventId: string
  participantId: string
}): Promise<ParticipantRowActionResult> {
  const auth = await authorize(input.tenantId)
  if (!auth.ok) return { error: auth.error }
  const { supabase, tenantId } = auth

  const participantId = participantIdSchema.safeParse(input.participantId)
  if (!participantId.success) return { error: await tError('actionErrors.invalidRequest') }

  const eventId = await resolveRequestEventId(supabase, tenantId, input.eventId)
  if (!eventId) return { error: await tError('actionErrors.invalidRequest') }

  const { data, error } = await supabase
    .from('participants')
    .delete()
    .eq('id', participantId.data)
    .eq('tenant_id', tenantId)
    .eq('event_id', eventId)
    .eq('source', 'manual')
    .select('id')

  if (error) {
    return {
      error: await translateDbError(
        'removeParticipant: delete failed',
        error,
        'participants.actions.genericError'
      ),
    }
  }

  if (!data || data.length === 0) {
    logger.warn('removeParticipant: no matching manual participant', {
      tenantId,
      eventId,
      participantId: participantId.data,
    })
    return { error: await tError('actionErrors.participantNotFound') }
  }

  revalidatePath(adminEventRoutePattern('participants'), 'page')

  return {}
}
