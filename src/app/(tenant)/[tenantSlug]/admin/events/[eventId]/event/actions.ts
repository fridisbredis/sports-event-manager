'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError, translateStorageError } from '@/lib/actions/db-error-message'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import {
  eventInfoCacheTag,
  adminEventCacheTag,
  workstationsCacheTag,
  adminDashboardCacheTag,
} from '@/lib/cache/tags'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { normalizeResultsUrl } from './_utils'
import { adminEventRoutePattern } from '@/lib/events/paths'

const tenantIdSchema = z.string().uuid()
const eventIdSchema = z.string().uuid()

export interface StageInput {
  id?: string
  name: string
  stage_type: 'race' | 'non_race'
  race_type: 'distance' | 'time'
  start_time: string | null
  end_time: string | null
  venue: string
  results_url: string | null
  position: number
  distances: LabelInput[]
}

export interface LabelInput {
  label: string
  position: number
}

export interface SaveEventInput {
  tenantSlug: string
  tenantId: string
  eventId: string
  name: string
  event_type: string
  description: string
  location: string
  logo_url: string
  scheduling_granularity_min: number
  stages: StageInput[]
  facilities: LabelInput[]
  // start_date and end_date are derived from Race stage times in this action
}

export interface SaveEventResult {
  error?: string
}

export async function saveEvent(input: SaveEventInput): Promise<SaveEventResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, input.tenantId)))
    return { error: await tError('actionErrors.notAuthorized') }

  // Scheduling granularity is fixed at 60 min in v1 (PO decision, 2026-09-30).
  // The UI no longer offers a choice; this guard is the server-side half, so a
  // direct call to this action can't write a value the scheduling grid mishandles
  // across midnight. See DatesAndGranularitySection for the underlying defect.
  if (input.scheduling_granularity_min !== 60) {
    return { error: await tError('actionErrors.granularityFixed') }
  }

  // Stage model v0.7: a published event must keep at least one Race stage
  // (mirrors the same check in publishEvent). Checked before any write so a
  // rejected save never leaves the events row partially updated. Fails
  // closed: if we can't confirm the event isn't published, we don't proceed.
  const { data: currentEvent, error: currentEventError } = await supabase
    .from('events')
    .select('status')
    .eq('id', input.eventId)
    .eq('tenant_id', input.tenantId)
    .single()

  if (currentEventError)
    return {
      error: await translateDbError('saveEvent: current event lookup failed', currentEventError),
    }

  const stageRowsHaveRaceStage = input.stages.some((s) => s.name.trim() && s.stage_type === 'race')
  if (currentEvent.status === 'published' && !stageRowsHaveRaceStage) {
    // Same message the DB raises as P0003 for this invariant (DB_ERROR_KEYS in
    // db-error-message.ts). Read from the same key rather than repeating the
    // literal, so this UI-level guard and the DB-level one can't drift apart
    // or land in different languages.
    const t = await getServerTranslation(await getUserLanguage(), 'admin')
    return { error: t('eventConfig.cannotRemoveLastRaceStage') }
  }

  // Derive start_date / end_date from Race stage times so the events row stays
  // coherent even though those columns are now nullable.
  const raceStages = input.stages.filter((s) => s.stage_type === 'race' && s.start_time)
  const derivedStartDate = raceStages.length > 0 ? raceStages[0].start_time!.slice(0, 10) : null
  const derivedEndDate =
    raceStages.length > 0
      ? ((raceStages.at(-1)!.end_time ?? raceStages.at(-1)!.start_time)?.slice(0, 10) ?? null)
      : null

  // NOT NULL columns: only include if non-empty so we don't violate constraints
  // on an incomplete draft. Nullable columns: always include so admins can clear them.
  const { error: eventError } = await supabase
    .from('events')
    .update({
      ...(input.name ? { name: input.name } : {}),
      ...(input.event_type ? { event_type: input.event_type } : {}),
      start_date: derivedStartDate,
      end_date: derivedEndDate,
      description: input.description || null,
      location: input.location || null,
      // Deliberately NOT `input.logo_url || null`, unlike the two fields
      // above. The logo is owned by uploadEventLogo and removeEventLogo,
      // which write the column themselves; this form field only ever carries
      // a copy of it. Coercing an empty copy to null meant any client-side
      // staleness silently destroyed the row's logo — the file stayed in the
      // bucket while events.logo_url went null, and the official-facing
      // screen fell back to its placeholder. An empty value here now means
      // "this save has nothing to say about the logo", so the column is left
      // alone; clearing it is an explicit action, not a side effect.
      ...(input.logo_url ? { logo_url: input.logo_url } : {}),
      scheduling_granularity_min: input.scheduling_granularity_min,
    })
    .eq('id', input.eventId)
    .eq('tenant_id', input.tenantId)

  if (eventError)
    return { error: await translateDbError('saveEvent: events update failed', eventError) }

  // Atomically replace all stages AND their distances via RPC (delete + insert
  // in one transaction). Distances are now embedded per Race stage in p_stages.
  const stageRows = input.stages
    .filter((s) => s.name.trim())
    .map((s, i) => ({
      ...(s.id ? { id: s.id } : {}),
      name: s.name,
      stage_type: s.stage_type,
      race_type: s.race_type,
      start_time: s.start_time || null,
      end_time: s.end_time || null,
      venue: s.venue,
      // Re-validated server-side, not trusted from the client: the modal
      // already rejects a non-http(s) link, but this action is callable
      // directly. A value that fails here is dropped to null rather than
      // failing the save — the link is an optional extra, and losing a whole
      // event edit over it would be the worse outcome. The RPC additionally
      // nulls it for non_race stages.
      results_url: (() => {
        const checked = normalizeResultsUrl(s.results_url ?? '')
        return checked.ok ? checked.value : null
      })(),
      position: i,
      distances: s.distances
        .filter((d) => d.label.trim())
        .map((d, j) => ({ label: d.label, position: j })),
    }))

  const { error: rpcError } = await supabase.rpc('sync_event_stages', {
    p_event_id: input.eventId,
    p_tenant_id: input.tenantId,
    p_stages: stageRows,
  })

  if (rpcError)
    return { error: await translateDbError('saveEvent: sync_event_stages failed', rpcError) }

  // REL-01: facilities are replaced atomically by this RPC — see migration
  // 20260908131614 and docs/patterns/atomic-multi-table-writes.md.
  // Previously this was a separate delete + insert with no transaction, so
  // a failure on the insert left the delete already committed, silently
  // wiping the event's facility list.
  const facilityRows = input.facilities
    .filter((f) => f.label.trim())
    .map((f, i) => ({ label: f.label, position: i }))

  const { error: facError } = await supabase.rpc('sync_event_facilities', {
    p_event_id: input.eventId,
    p_tenant_id: input.tenantId,
    p_facilities: facilityRows,
  })
  if (facError)
    return { error: await translateDbError('saveEvent: sync_event_facilities failed', facError) }

  revalidatePath(adminEventRoutePattern('event'), 'page')
  revalidatePath(adminEventRoutePattern('dashboard'), 'page')

  // PERF-06 / F-PERF-04 Phase 2 (ADR-0003): saveEvent touches events,
  // event_stages, event_distances, and event_facilities — every Group 1
  // cached page reads at least one of those tables, so all three tags are
  // invalidated. updateTag (not revalidateTag) so the admin who just saved
  // sees their own write immediately on next render.
  updateTag(eventInfoCacheTag(input.tenantId))
  updateTag(adminEventCacheTag(input.tenantId))
  updateTag(workstationsCacheTag(input.tenantId))

  // PERF-06 / F-PERF-04 Phase 3: the dashboard's cached summary reads events
  // (name, dates, status) and event_stages (race-stage count) — both changed
  // by this same write.
  updateTag(adminDashboardCacheTag(input.tenantId))

  return {}
}

export interface UploadLogoResult {
  publicUrl?: string
  error?: string
}

function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  return decodeURIComponent(url.slice(idx + marker.length))
}

// Must stay UNDER Next.js's default 1 MB Server Action body cap. Above that
// the request is rejected by the framework with a 413 before this action
// runs, so a larger value here would be advertised in the error copy but
// never actually enforced — the user would just see a generic failure.
// The client downscales to a 512px WebP first (see resizeImage), which lands
// well under 100 kB in practice; this is the backstop for anything that
// bypasses it, not the expected path.
const MAX_LOGO_BYTES = 900 * 1024

export async function uploadEventLogo(formData: FormData): Promise<UploadLogoResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const file = formData.get('file')
  const tenantId = formData.get('tenantId') as string
  const eventId = formData.get('eventId') as string
  const tenantSlug = formData.get('tenantSlug') as string
  const oldLogoUrl = (formData.get('oldLogoUrl') as string) || ''

  if (!(file instanceof File)) return { error: await tError('actionErrors.noFileProvided') }
  if (!file.type.startsWith('image/'))
    return { error: await tError('actionErrors.chooseImageFile') }
  if (file.size > MAX_LOGO_BYTES) return { error: await tError('actionErrors.imageTooLarge') }
  if (!tenantId || !eventId || !tenantSlug)
    return { error: await tError('actionErrors.missingTenantOrEvent') }

  const parsedTenantId = tenantIdSchema.safeParse(tenantId)
  if (!parsedTenantId.success) {
    logger.warn('uploadEventLogo: invalid tenantId', { tenantId })
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }

  // Validated now that it reaches an .eq() filter and the storage path, not
  // just the path as before.
  const parsedEventId = eventIdSchema.safeParse(eventId)
  if (!parsedEventId.success) {
    logger.warn('uploadEventLogo: invalid eventId', { eventId })
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: await tError('actionErrors.notAuthorized') }

  const ext = file.name.includes('.') ? file.name.split('.').pop() : 'jpg'
  const path = `${parsedTenantId.data}/${parsedEventId.data}/${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('logos')
    .upload(path, file, { contentType: file.type })

  if (uploadError)
    return {
      error: await translateStorageError('uploadEventLogo: storage upload failed', uploadError),
    }

  const { data } = supabase.storage.from('logos').getPublicUrl(path)

  // Write the column here rather than leaving it to the next saveEvent. An
  // upload is a completed action from the admin's point of view — the new
  // logo is on screen the moment it finishes — so the row has to agree with
  // what they can see, even if they never press Save, navigate away, or the
  // tab crashes. Leaving it to Save also made the file and the column drift
  // apart in prod: the object existed in the bucket while events.logo_url
  // was still null, and the official-facing screen rendered its placeholder.
  const { error: persistError } = await supabase
    .from('events')
    .update({ logo_url: data.publicUrl })
    .eq('id', parsedEventId.data)
    .eq('tenant_id', parsedTenantId.data)

  if (persistError) {
    // The object is already in the bucket but the row does not point at it.
    // Remove the orphan so a retry does not pile up unreferenced files, and
    // report the failure instead of handing back a URL the form would show
    // as saved.
    await supabase.storage.from('logos').remove([path])
    return { error: await translateDbError('uploadEventLogo: events update failed', persistError) }
  }

  // Best-effort cleanup of old logo — ignore errors. Only after the row
  // points at the new file: deleting first would leave the event with a
  // dangling logo_url if the update above failed.
  const oldPath = extractStoragePath(oldLogoUrl, 'logos')
  if (oldPath && oldPath !== path) {
    await supabase.storage.from('logos').remove([oldPath])
  }

  // The new logo is live for every screen that reads it, not just this form.
  revalidatePath(adminEventRoutePattern('event'), 'page')
  revalidatePath(adminEventRoutePattern('dashboard'), 'page')
  updateTag(eventInfoCacheTag(parsedTenantId.data))
  updateTag(adminEventCacheTag(parsedTenantId.data))
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return { publicUrl: data.publicUrl }
}

export interface RemoveLogoResult {
  error?: string
}

// The explicit counterpart to uploadEventLogo. Clearing the logo used to be a
// client-state change that saveEvent happened to persist by coercing an empty
// string to null — the same coercion that let a stale form silently wipe the
// column. Now that saveEvent leaves logo_url alone, removal needs its own
// action, which also makes it symmetric with upload: both write the row and
// both keep the bucket in step with it.
export async function removeEventLogo(
  tenantSlug: string,
  tenantId: string,
  eventId: string
): Promise<RemoveLogoResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(tenantId)
  const parsedEventId = eventIdSchema.safeParse(eventId)
  if (!parsedTenantId.success || !parsedEventId.success) {
    logger.warn('removeEventLogo: invalid ids', { tenantId, eventId })
    return { error: await tError('actionErrors.missingTenantOrEvent') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: await tError('actionErrors.notAuthorized') }

  // Read the current value rather than trusting one sent from the client:
  // the path to delete has to come from what the row actually holds, or a
  // stale client could point the removal at another event's file.
  const { data: current, error: readError } = await supabase
    .from('events')
    .select('logo_url')
    .eq('id', parsedEventId.data)
    .eq('tenant_id', parsedTenantId.data)
    .single()

  if (readError)
    return { error: await translateDbError('removeEventLogo: event lookup failed', readError) }

  const { error: updateError } = await supabase
    .from('events')
    .update({ logo_url: null })
    .eq('id', parsedEventId.data)
    .eq('tenant_id', parsedTenantId.data)

  if (updateError)
    return { error: await translateDbError('removeEventLogo: events update failed', updateError) }

  // Row first, file second: an orphaned object is harmless, a dangling
  // logo_url is a broken image on every screen that reads it.
  const path = extractStoragePath(current.logo_url ?? '', 'logos')
  if (path) {
    await supabase.storage.from('logos').remove([path])
  }

  revalidatePath(adminEventRoutePattern('event'), 'page')
  revalidatePath(adminEventRoutePattern('dashboard'), 'page')
  updateTag(eventInfoCacheTag(parsedTenantId.data))
  updateTag(adminEventCacheTag(parsedTenantId.data))
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return {}
}
