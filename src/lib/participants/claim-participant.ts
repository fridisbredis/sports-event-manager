import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

const uuid = z.string().uuid()

// The reasons claim_participant (migration 20261106120000) refuses, each its
// own P0001 message. Anything else is 'failed'.
export const CLAIM_PARTICIPANT_ERRORS = [
  'not_found',
  'already_claimed',
  'already_in_event',
] as const

export type ClaimParticipantError = (typeof CLAIM_PARTICIPANT_ERRORS)[number] | 'failed'

export type ClaimParticipantResult =
  | { ok: true; participantId: string; eventId: string; roleGranted: boolean }
  | { ok: false; error: ClaimParticipantError }

/**
 * N35 (L5): link the signed-in account to a participant record in a tenant.
 *
 * The server-side half of the claim; the UI is N40. `userId` must come from
 * the verified session, never from the client: the SMS-verified phone the
 * person signed in with is the proof of who they are, and the RPC writes it
 * into participants.phone. The record's own phone is not checked — imported
 * participants have none — and the first claim wins (a later one is a conflict, N42).
 * The RPC is granted to service_role only, hence the service client.
 *
 * An official who claims keeps their single tenant role row and gains the
 * participant membership; someone with no role in the tenant gets
 * 'participant' (roleGranted). No second user is ever created.
 */
export async function claimParticipant(
  userId: string,
  participantId: string,
  tenantId: string
): Promise<ClaimParticipantResult> {
  if (![userId, participantId, tenantId].every((id) => uuid.safeParse(id).success)) {
    return { ok: false, error: 'not_found' }
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service.rpc('claim_participant', {
    p_user_id: userId,
    p_participant_id: participantId,
    p_tenant_id: tenantId,
  })

  if (error) {
    const known = CLAIM_PARTICIPANT_ERRORS.find((code) => code === error.message)
    if (known) return { ok: false, error: known }
    logger.error('claim_participant failed', error)
    return { ok: false, error: 'failed' }
  }

  const result = data as unknown as {
    participant_id: string
    event_id: string
    role_granted: boolean
  }

  return {
    ok: true,
    participantId: result.participant_id,
    eventId: result.event_id,
    roleGranted: result.role_granted,
  }
}

// submit_participant_claim (migration 20261110142443) adds one refusal of its
// own on top of claim_participant's. It never raises already_claimed — a
// claimed record becomes a conflict instead — but the list is shared.
export const SUBMIT_CLAIM_ERRORS = [...CLAIM_PARTICIPANT_ERRORS, 'privacy_not_accepted'] as const

export type SubmitClaimError = (typeof SUBMIT_CLAIM_ERRORS)[number] | 'failed'

/**
 * claimed  — the record is now theirs (or already was).
 * conflict — someone else holds it; their claim is stored for an admin to
 *            decide (N42, L6/L11). No access is granted.
 */
export type SubmitClaimOutcome = 'claimed' | 'conflict'

export type SubmitClaimResult =
  | {
      ok: true
      outcome: SubmitClaimOutcome
      participantId: string
      eventId: string
      roleGranted: boolean
    }
  | { ok: false; error: SubmitClaimError }

/**
 * N40/N42 (CLAIM-02): what the Complete button sends. One transaction that
 * either claims the record — link, event check and privacy consent (REL-01)
 * — or, when another account already holds it, stores a claim conflict.
 * The choice is made under the row lock, so two runners pressing Complete
 * at once give one claim and one conflict, never two claims.
 *
 * `eventId` and `tenantId` must come from the claim token (loadClaimTarget),
 * never from the request body, and `userId` from the verified session. The
 * RPC refuses a participant outside that event, or one that is withdrawn or
 * hidden, with the same not_found as an unknown id.
 */
export async function submitParticipantClaim(input: {
  userId: string
  participantId: string
  tenantId: string
  eventId: string
  privacyAccepted: boolean
}): Promise<SubmitClaimResult> {
  const { userId, participantId, tenantId, eventId, privacyAccepted } = input
  if (![userId, participantId, tenantId, eventId].every((id) => uuid.safeParse(id).success)) {
    return { ok: false, error: 'not_found' }
  }

  const service = createSupabaseServiceClient()
  const { data, error } = await service.rpc('submit_participant_claim', {
    p_user_id: userId,
    p_participant_id: participantId,
    p_tenant_id: tenantId,
    p_event_id: eventId,
    p_privacy_accepted: privacyAccepted,
  })

  if (error) {
    const known = SUBMIT_CLAIM_ERRORS.find((code) => code === error.message)
    if (known) return { ok: false, error: known }
    logger.error('submit_participant_claim failed', error)
    return { ok: false, error: 'failed' }
  }

  // jsonb, so these keys are not type-checked (F-REL-16); the shape is
  // asserted against real Postgres in tests/integration/participant-claim-conflicts.test.ts.
  const result = data as unknown as {
    participant_id: string
    event_id: string
    role_granted: boolean
    outcome: SubmitClaimOutcome
  }

  return {
    ok: true,
    outcome: result.outcome === 'conflict' ? 'conflict' : 'claimed',
    participantId: result.participant_id,
    eventId: result.event_id,
    roleGranted: result.role_granted,
  }
}
