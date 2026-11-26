import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
  createSupabaseServiceClient: vi.fn(() => ({ storage: 'service' })),
}))
vi.mock('@/lib/auth/tenant', () => ({
  getCurrentUser: vi.fn(),
  getParticipantTenant: vi.fn(),
}))
vi.mock('@/lib/participants/participant-avatar', () => ({
  removeParticipantAvatar: vi.fn(),
}))
vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('@/lib/actions/action-error', () => ({
  translateActionError: vi.fn(async (key: string) => key),
}))
vi.mock('@/lib/actions/db-error-message', () => ({
  translateDbError: vi.fn(async () => 'db-error'),
}))

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { removeParticipantAvatar } from '@/lib/participants/participant-avatar'
import { revalidatePath } from 'next/cache'
import { leaveParticipantEvent } from './actions'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_A = '22222222-2222-4222-8222-222222222222'
const EVENT_B = '33333333-3333-4333-8333-333333333333'
const PART_A = '44444444-4444-4444-8444-444444444444'
const PART_B = '55555555-5555-4555-8555-555555555555'

function tenantWith(entries: { participantId: string; eventId: string }[]) {
  return { id: TENANT_ID, slug: 'viadal', entries } as never
}

function rpcReturning(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null })
  vi.mocked(createSupabaseServerClient).mockResolvedValue({ rpc } as never)
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user-1' } as never)
})

describe('leaveParticipantEvent', () => {
  it('redirects to /login without a session', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    await expect(leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })).rejects.toThrow(
      'REDIRECT:/login'
    )
  })

  it('rejects a malformed event id before any lookup', async () => {
    const result = await leaveParticipantEvent({ tenantSlug: 'viadal', eventId: 'nope' })
    expect(result).toEqual({ error: 'actionErrors.invalidRequest' })
    expect(getParticipantTenant).not.toHaveBeenCalled()
  })

  it('refuses a caller with no participant access in the tenant', async () => {
    vi.mocked(getParticipantTenant).mockResolvedValue(null)
    const rpc = rpcReturning({})
    const result = await leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })
    expect(result).toEqual({ error: 'actionErrors.notAuthorized' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("never calls the RPC for an event that is not among the caller's entries", async () => {
    vi.mocked(getParticipantTenant).mockResolvedValue(
      tenantWith([{ participantId: PART_B, eventId: EVENT_B }])
    )
    const rpc = rpcReturning({})
    const result = await leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })
    expect(result).toEqual({ error: 'actionErrors.participantEntryGone' })
    expect(rpc).not.toHaveBeenCalled()
  })

  it('reports a record that is no longer the caller’s, and touches no photo', async () => {
    vi.mocked(getParticipantTenant).mockResolvedValue(
      tenantWith([{ participantId: PART_A, eventId: EVENT_A }])
    )
    rpcReturning({ data: { left: false } })
    const result = await leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })
    expect(result).toEqual({ error: 'actionErrors.participantEntryGone' })
    expect(removeParticipantAvatar).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns a translated error when the RPC fails', async () => {
    vi.mocked(getParticipantTenant).mockResolvedValue(
      tenantWith([{ participantId: PART_A, eventId: EVENT_A }])
    )
    rpcReturning({ error: { code: '42501', message: 'denied' } })
    const result = await leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })
    expect(result).toEqual({ error: 'db-error' })
  })

  it('leaves one of two events and goes back to participant Start', async () => {
    vi.mocked(getParticipantTenant).mockResolvedValue(
      tenantWith([
        { participantId: PART_A, eventId: EVENT_A },
        { participantId: PART_B, eventId: EVENT_B },
      ])
    )
    const rpc = rpcReturning({ data: { left: true, avatar_url: 'http://x/photo.webp' } })

    await expect(leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })).rejects.toThrow(
      'REDIRECT:/viadal/participant'
    )

    // The record id comes from the caller's own entries, never the client.
    expect(rpc).toHaveBeenCalledWith('leave_own_participant_entry', { p_participant_id: PART_A })
    expect(removeParticipantAvatar).toHaveBeenCalledWith(
      expect.anything(),
      'http://x/photo.webp',
      { tenantId: TENANT_ID, participantId: PART_A },
      'leaveParticipantEvent'
    )
    expect(revalidatePath).toHaveBeenCalledWith('/[tenantSlug]/participant', 'layout')
  })

  it('sends the caller to /dashboard after leaving their last event', async () => {
    vi.mocked(getParticipantTenant).mockResolvedValue(
      tenantWith([{ participantId: PART_A, eventId: EVENT_A }])
    )
    rpcReturning({ data: { left: true, avatar_url: null } })

    await expect(leaveParticipantEvent({ tenantSlug: 'viadal', eventId: EVENT_A })).rejects.toThrow(
      'REDIRECT:/dashboard'
    )
  })
})
