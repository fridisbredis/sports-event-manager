import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

const uuid = z.string().uuid()

// The reasons claim_participant (migration 20261106120000) refuses, each its
// own P0001 message. Anything else is 'failed'.
export const CLAIM_PARTICIPANT_ERRORS = [
  'not_found',
  'already_claimed',
  'phone_mismatch',
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
 * the verified session, never from the client — the RPC reads that user's
 * phone from auth.users and refuses a record whose phone does not match, so
 * the phone the person signed in with is the security boundary. The RPC is
 * granted to service_role only, hence the service client.
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
