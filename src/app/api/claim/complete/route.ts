import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'
import { locales } from '@/lib/i18n/config'
import { iceContactInputSchema, isIceContactEmpty, normalizeIceContact } from '@/lib/ice-contact'
import { loadClaimTarget } from '@/lib/participants/claim-target'
import { submitParticipantClaim } from '@/lib/participants/claim-participant'
import { loadClaimPrefill } from '@/lib/participants/claim-prefill'
import { copyAvatarToParticipant } from '@/lib/participants/participant-avatar'

// N40 (CLAIM-02, L6, L7, L13): the Complete button.
//
// The claim itself — link, event check and consent — is ONE transaction in
// submit_participant_claim (REL-01). What follows it is best-effort, the
// same rule as the invite confirm route: language, ICE contact and a kept
// photo are things the runner can set later on My account, so none of them
// may turn a claim that has already committed into a failed request.
//
// N42: the same button on a record someone else already holds stores a claim
// conflict instead (outcome 'conflict'). The runner gets no access; language
// and ICE are still saved, since they belong to the account and help the
// admin who calls them. The photo is not: it would go on a record that is
// not theirs.
//
// The event and tenant come from the token, the user from the session.
// The body only ever names the participant, and the RPC re-checks that the
// participant belongs to the token's event.

const schema = z.object({
  token: z.string().uuid(),
  participantId: z.string().uuid(),
  // L7. Checked in the UI too; the server is the one that counts.
  identityConfirmed: z.literal(true),
  privacyAccepted: z.literal(true),
  language: z.enum(locales).optional(),
  ice: iceContactInputSchema.optional(),
  // existing-account: keep the photo they already have in the tenant.
  keepExistingPhoto: z.boolean().optional(),
})

const OP = 'POST /api/claim/complete'

const ERROR_STATUS = {
  not_found: 404,
  already_claimed: 409,
  already_in_event: 409,
  privacy_not_accepted: 400,
  failed: 500,
} as const

export async function POST(request: NextRequest) {
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { token, participantId, language, keepExistingPhoto } = parsed.data

  // Before anything commits, so a bad ICE number is still fixable on the form.
  const ice = parsed.data.ice ? normalizeIceContact(parsed.data.ice) : null
  if (ice && !ice.ok) {
    return NextResponse.json(
      { error: 'Invalid ICE phone number', code: 'invalid_ice_phone' },
      { status: 400 }
    )
  }

  const supabase = await createSupabaseServerClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, { op: OP, table: 'auth.users', kind: 'select' })
  }
  const user = auth.user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createSupabaseServiceClient()
  const target = await loadClaimTarget(service, token, participantId, OP)
  if (target.kind === 'not_found') {
    return NextResponse.json({ error: 'Not found', code: 'not_found' }, { status: 404 })
  }
  if (target.kind === 'closed') {
    return NextResponse.json({ error: 'Claiming is not open', code: 'not_open' }, { status: 403 })
  }

  // Read before the claim: afterwards this row is theirs and would shadow
  // the photo they had elsewhere.
  const prefill = keepExistingPhoto
    ? await loadClaimPrefill(supabase, {
        userId: user.id,
        tenantId: target.tenantId,
        eventId: target.eventId,
        participantId,
        op: OP,
      })
    : null

  const result = await submitParticipantClaim({
    userId: user.id,
    participantId,
    tenantId: target.tenantId,
    eventId: target.eventId,
    privacyAccepted: true,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: 'Claim failed', code: result.error },
      { status: ERROR_STATUS[result.error] }
    )
  }

  // ---- Best-effort from here: the claim (or conflict) has committed. ----
  //
  // The RLS client, not service_role: the session cookie set by
  // /api/auth/verify-otp is on this request, and the own-row policies on
  // user_preferences and user_ice_contacts are exactly the right scope.

  if (language) {
    const { error } = await supabase
      .from('user_preferences')
      .upsert(
        { user_id: user.id, language, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    if (error) {
      logQueryError(error, {
        op: OP,
        table: 'user_preferences',
        kind: 'update',
        tenantId: target.tenantId,
        extra: { usage: 'claim_language' },
      })
    }
  }

  // Only a contact with something in it is written. An empty form from
  // someone who already has a contact must not erase it — clearing it is
  // ACCT-01's job, where the runner can see what they are removing.
  if (ice?.ok && !isIceContactEmpty(ice.contact)) {
    const { error } = await supabase
      .from('user_ice_contacts')
      .upsert(
        { user_id: user.id, ...ice.contact, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      )
    if (error) {
      logQueryError(error, {
        op: OP,
        table: 'user_ice_contacts',
        kind: 'update',
        tenantId: target.tenantId,
        extra: { usage: 'claim_ice_contact' },
      })
    }
  }

  // A photo already on this very row (a repeated claim) needs no copy, and a
  // conflict has no row of its own to put one on.
  const source = prefill?.avatarUrl
  if (result.outcome === 'claimed' && source && !prefill.claimedByYou) {
    await copyAvatarToParticipant(
      service,
      { tenantId: target.tenantId, participantId, userId: user.id },
      source,
      OP
    )
  }

  return NextResponse.json({
    ok: true,
    outcome: result.outcome,
    roleGranted: result.roleGranted,
  })
}
