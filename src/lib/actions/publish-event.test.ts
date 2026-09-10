import { describe, it, expect, vi, beforeEach } from 'vitest'
import { publishEvent } from './publish-event'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { logger } from '@/lib/logger'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function mockClient(rpcMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    rpc: rpcMock,
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'
const INPUT = { tenantSlug: 'viadal', tenantId: TENANT_ID, eventId: EVENT_ID }

beforeEach(() => {
  vi.clearAllMocks()
})

const PUBLISH_PRECONDITION_ERROR =
  "This event can't be published yet. Make sure it has a name and at least one Race stage, then try again."

// EVT-02: publishEvent now delegates the name/status/Race-stage-count check
// and the publish write to a single publish_event RPC (migration
// 20260908143523), which holds a row lock across both to close a TOCTOU race
// against sync_event_stages. These tests mock supabase.rpc() instead of the
// old two-call supabase.from('events') chain.
describe('publishEvent', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      rpc: vi.fn(),
    } as never)

    await expect(publishEvent(INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error and never calls the RPC when access is denied', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const rpcMock = vi.fn()
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('returns an error when the event is not found for this tenant (P0002)', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'P0002', message: 'not found' } })
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    // F-REL-22: never forward the raw DB error message to the client.
    expect(result).toEqual({
      error: 'This event could not be found. Refresh the page and try again.',
    })
    expect(rpcMock).toHaveBeenCalledWith('publish_event', {
      p_event_id: EVENT_ID,
      p_tenant_id: TENANT_ID,
    })
  })

  // REL-03 + F-REL-22 interaction: publishEvent logs the failure itself via
  // logQueryError (which carries op/table/kind/tenantId for Log Analytics) and
  // tells translateDbError not to log, so one failure produces one log line
  // rather than two of differing shape.
  it('logs a real RPC failure exactly once, with the structured context', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    mockClient(
      vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'RLS denied' } })
    )

    await publishEvent(INPUT)

    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error).toHaveBeenCalledWith(
      'publishEvent: rpc on publish_event failed',
      expect.anything(),
      expect.objectContaining({
        op: 'publishEvent',
        table: 'publish_event',
        kind: 'rpc',
        pgCode: '42501',
        tenantId: TENANT_ID,
        eventId: EVENT_ID,
      })
    )
  })

  it('does not log P0002, which is an ordinary not-found rather than a failure', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    mockClient(
      vi.fn().mockResolvedValue({ data: null, error: { code: 'P0002', message: 'not found' } })
    )

    await publishEvent(INPUT)

    expect(logger.error).not.toHaveBeenCalled()
  })

  it('is a no-op success and skips revalidation when the event is already published', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    // publish_event returns false (no-op) when the event was already published.
    const rpcMock = vi.fn().mockResolvedValue({ data: false, error: null })
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('returns an error when the event name is empty or only whitespace (23514)', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'Event name is required before publishing.' },
    })
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    // F-REL-22: publish_event's two 23514 cases (blank name, no Race stage)
    // share one translated message naming both preconditions — the client
    // already pre-validates both before calling, so this is a rare backstop
    // and doesn't need the two discriminated (unlike sync_event_stages'
    // P0003 vs 23514, see db-error-message.ts).
    expect(result).toEqual({
      error: PUBLISH_PRECONDITION_ERROR,
    })
  })

  it('returns an error when there are no Race stages (23514)', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'Add at least one Race stage before publishing.' },
    })
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({
      error: PUBLISH_PRECONDITION_ERROR,
    })
  })

  it('publishes the event and revalidates both admin paths on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    // publish_event returns true when it actually transitioned draft -> published.
    const rpcMock = vi.fn().mockResolvedValue({ data: true, error: null })
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({})
    expect(rpcMock).toHaveBeenCalledWith('publish_event', {
      p_event_id: EVENT_ID,
      p_tenant_id: TENANT_ID,
    })
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/event')
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/dashboard')
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-event-info`)
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-event`)
    expect(updateTag).not.toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-workstations`)
    // PERF-06 / F-PERF-04 Phase 3
    expect(updateTag).toHaveBeenCalledWith(`tenant-${TENANT_ID}-admin-dashboard`)
  })

  it('translates the RPC error and skips revalidation when the RPC fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const rpcMock = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XXXXX', message: 'db is down' } })
    mockClient(rpcMock)

    const result = await publishEvent(INPUT)

    // F-REL-22: never forward the raw DB error message to the client — and
    // an unmapped code (a transient/infra failure) must get the generic
    // message, not a precondition message that would be confidently wrong
    // about why publishing failed.
    expect(result).toEqual({
      error: 'Something went wrong while saving. Please try again.',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
    expect(updateTag).not.toHaveBeenCalled()
  })
})
