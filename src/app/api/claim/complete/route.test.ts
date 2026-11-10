import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from './route'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadClaimTarget } from '@/lib/participants/claim-target'
import { submitParticipantClaim } from '@/lib/participants/claim-participant'
import { loadClaimPrefill } from '@/lib/participants/claim-prefill'
import { copyAvatarToParticipant } from '@/lib/participants/participant-avatar'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(() => ({ service: true })),
}))
vi.mock('@/lib/participants/claim-target', () => ({ loadClaimTarget: vi.fn() }))
vi.mock('@/lib/participants/claim-participant', () => ({ submitParticipantClaim: vi.fn() }))
vi.mock('@/lib/participants/claim-prefill', () => ({ loadClaimPrefill: vi.fn() }))
vi.mock('@/lib/participants/participant-avatar', () => ({ copyAvatarToParticipant: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))

const TOKEN = '0b8a3c3e-6f1d-4c55-9a43-0f5e2b7d9a11'
const PARTICIPANT = '22222222-2222-4222-8222-222222222222'
const USER = '11111111-1111-4111-8111-111111111111'

const upsert = vi.fn()
const from = vi.fn(() => ({ upsert }))
const getUser = vi.fn()

function request(body: unknown) {
  return new NextRequest('http://localhost/api/claim/complete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const valid = {
  token: TOKEN,
  participantId: PARTICIPANT,
  identityConfirmed: true,
  privacyAccepted: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: USER } }, error: null })
  upsert.mockResolvedValue({ error: null })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ auth: { getUser }, from } as never)
  vi.mocked(loadClaimTarget).mockResolvedValue({
    kind: 'open',
    event: { name: 'Viadal', logoUrl: null, palette: 'default' },
    eventId: 'event-1',
    tenantId: 'tenant-1',
    participant: { id: PARTICIPANT, bib: '101', name: 'Lisa Nord', claimed: false },
  })
  vi.mocked(submitParticipantClaim).mockResolvedValue({
    ok: true,
    outcome: 'claimed',
    participantId: PARTICIPANT,
    eventId: 'event-1',
    roleGranted: true,
  })
})

describe('POST /api/claim/complete (N40)', () => {
  it('claims with the event and tenant from the token and the user from the session', async () => {
    const res = await POST(request(valid))

    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('claimed')
    expect(submitParticipantClaim).toHaveBeenCalledWith({
      userId: USER,
      participantId: PARTICIPANT,
      tenantId: 'tenant-1',
      eventId: 'event-1',
      privacyAccepted: true,
    })
  })

  it.each([
    ['identity not confirmed', { identityConfirmed: false }],
    ['privacy not accepted', { privacyAccepted: false }],
  ])('refuses with %s, before any claim', async (_label, override) => {
    const res = await POST(request({ ...valid, ...override }))

    expect(res.status).toBe(400)
    expect(submitParticipantClaim).not.toHaveBeenCalled()
  })

  it('refuses without a session', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })

    const res = await POST(request(valid))

    expect(res.status).toBe(401)
    expect(submitParticipantClaim).not.toHaveBeenCalled()
  })

  it('refuses a closed event', async () => {
    vi.mocked(loadClaimTarget).mockResolvedValue({
      kind: 'closed',
      event: { name: 'V', logoUrl: null, palette: 'd' },
    })

    const res = await POST(request(valid))

    expect(res.status).toBe(403)
    expect(submitParticipantClaim).not.toHaveBeenCalled()
  })

  it('rejects an invalid ICE phone before claiming, so the form can still fix it', async () => {
    const res = await POST(
      request({ ...valid, ice: { phone: 'not a number', name: '', relation: '' } })
    )

    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_ice_phone')
    expect(submitParticipantClaim).not.toHaveBeenCalled()
  })

  it.each([
    ['already_claimed', 409],
    ['already_in_event', 409],
    ['not_found', 404],
    ['failed', 500],
  ] as const)('maps the RPC refusal %s to %i and writes nothing else', async (code, status) => {
    vi.mocked(submitParticipantClaim).mockResolvedValue({ ok: false, error: code })

    const res = await POST(request({ ...valid, language: 'sv' }))

    expect(res.status).toBe(status)
    expect((await res.json()).code).toBe(code)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('stores language and ICE after the claim, and a failure there does not fail it', async () => {
    upsert.mockResolvedValue({ error: { message: 'boom', code: 'XX000' } })

    const res = await POST(
      request({
        ...valid,
        language: 'sv',
        ice: { phone: '070 123 45 67', name: 'Anna', relation: 'Partner' },
      })
    )

    expect(res.status).toBe(200)
    expect(from).toHaveBeenCalledWith('user_preferences')
    expect(from).toHaveBeenCalledWith('user_ice_contacts')
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER, phone: '46701234567', name: 'Anna' }),
      { onConflict: 'user_id' }
    )
  })

  it('does not erase an existing ICE contact when the form sends an empty one', async () => {
    await POST(request({ ...valid, ice: { phone: '', name: '', relation: '' } }))

    expect(from).not.toHaveBeenCalledWith('user_ice_contacts')
  })

  it('copies the photo the account already has when asked to keep it', async () => {
    vi.mocked(loadClaimPrefill).mockResolvedValue({
      existingAccount: true,
      alreadyInEvent: false,
      claimedByYou: false,
      avatarUrl: 'https://x/storage/v1/object/public/avatars/tenant-1/o/1.webp',
      ice: null,
      language: null,
    })

    await POST(request({ ...valid, keepExistingPhoto: true }))

    expect(copyAvatarToParticipant).toHaveBeenCalledWith(
      expect.anything(),
      { tenantId: 'tenant-1', participantId: PARTICIPANT, userId: USER },
      'https://x/storage/v1/object/public/avatars/tenant-1/o/1.webp',
      expect.any(String)
    )
  })

  // N42: "This is me" on a record someone else holds.
  describe('when the record is held by someone else (conflict)', () => {
    beforeEach(() => {
      vi.mocked(submitParticipantClaim).mockResolvedValue({
        ok: true,
        outcome: 'conflict',
        participantId: PARTICIPANT,
        eventId: 'event-1',
        roleGranted: false,
      })
    })

    it('answers 200 with outcome conflict and no role', async () => {
      const res = await POST(request(valid))

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, outcome: 'conflict', roleGranted: false })
    })

    it('still stores the account language and ICE contact', async () => {
      await POST(
        request({
          ...valid,
          language: 'sv',
          ice: { phone: '070 123 45 67', name: 'Anna', relation: 'Partner' },
        })
      )

      expect(from).toHaveBeenCalledWith('user_preferences')
      expect(from).toHaveBeenCalledWith('user_ice_contacts')
    })

    it('never copies a photo onto a record that is not theirs', async () => {
      vi.mocked(loadClaimPrefill).mockResolvedValue({
        existingAccount: true,
        alreadyInEvent: false,
        claimedByYou: false,
        avatarUrl: 'https://x/storage/v1/object/public/avatars/tenant-1/o/1.webp',
        ice: null,
        language: null,
      })

      await POST(request({ ...valid, keepExistingPhoto: true }))

      expect(copyAvatarToParticipant).not.toHaveBeenCalled()
    })
  })
})
