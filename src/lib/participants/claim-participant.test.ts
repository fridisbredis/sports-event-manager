import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { claimParticipant, submitParticipantClaim } from './claim-participant'

vi.mock('@/lib/supabase/server', () => ({ createSupabaseServiceClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }))

const USER = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const EVENT = '44444444-4444-4444-8444-444444444444'

// The SQL itself is covered by tests/integration/participant-claim-roles.test.ts;
// this covers the mapping from the RPC's answer to the app's result.
describe('claimParticipant', () => {
  const rpc = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  })

  it('passes the ids through and maps the jsonb keys', async () => {
    rpc.mockResolvedValue({
      data: { participant_id: PARTICIPANT, event_id: EVENT, role_granted: true },
      error: null,
    })
    expect(await claimParticipant(USER, PARTICIPANT, TENANT)).toEqual({
      ok: true,
      participantId: PARTICIPANT,
      eventId: EVENT,
      roleGranted: true,
    })
    expect(rpc).toHaveBeenCalledWith('claim_participant', {
      p_user_id: USER,
      p_participant_id: PARTICIPANT,
      p_tenant_id: TENANT,
    })
  })

  it.each(['not_found', 'already_claimed', 'already_in_event'])(
    'returns the RPC refusal %s as its own error',
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: { message: code, code: 'P0001' } })
      expect(await claimParticipant(USER, PARTICIPANT, TENANT)).toEqual({ ok: false, error: code })
    }
  )

  it('reports anything else as failed', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom', code: 'XX000' } })
    expect(await claimParticipant(USER, PARTICIPANT, TENANT)).toEqual({
      ok: false,
      error: 'failed',
    })
  })

  it('does not call the RPC with a malformed id', async () => {
    expect(await claimParticipant('nope', PARTICIPANT, TENANT)).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('submitParticipantClaim (N40, N42)', () => {
  const rpc = vi.fn()
  const input = {
    userId: USER,
    participantId: PARTICIPANT,
    tenantId: TENANT,
    eventId: EVENT,
    privacyAccepted: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ rpc } as never)
  })

  it('calls submit_participant_claim with the event and consent', async () => {
    rpc.mockResolvedValue({
      data: {
        participant_id: PARTICIPANT,
        event_id: EVENT,
        role_granted: false,
        outcome: 'claimed',
      },
      error: null,
    })

    expect(await submitParticipantClaim(input)).toEqual({
      ok: true,
      outcome: 'claimed',
      participantId: PARTICIPANT,
      eventId: EVENT,
      roleGranted: false,
    })
    expect(rpc).toHaveBeenCalledWith('submit_participant_claim', {
      p_user_id: USER,
      p_participant_id: PARTICIPANT,
      p_tenant_id: TENANT,
      p_event_id: EVENT,
      p_privacy_accepted: true,
    })
  })

  it('reports a stored conflict as its own outcome', async () => {
    rpc.mockResolvedValue({
      data: {
        participant_id: PARTICIPANT,
        event_id: EVENT,
        role_granted: false,
        outcome: 'conflict',
      },
      error: null,
    })

    expect(await submitParticipantClaim(input)).toMatchObject({ ok: true, outcome: 'conflict' })
  })

  it.each(['not_found', 'already_claimed', 'already_in_event', 'privacy_not_accepted'])(
    'returns the refusal %s as its own error',
    async (code) => {
      rpc.mockResolvedValue({ data: null, error: { message: code, code: 'P0001' } })
      expect(await submitParticipantClaim(input)).toEqual({ ok: false, error: code })
    }
  )

  it('does not call the RPC with a malformed event id', async () => {
    expect(await submitParticipantClaim({ ...input, eventId: 'nope' })).toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(rpc).not.toHaveBeenCalled()
  })
})
