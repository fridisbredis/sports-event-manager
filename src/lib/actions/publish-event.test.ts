import { describe, it, expect, vi, beforeEach } from 'vitest'
import { publishEvent } from './publish-event'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

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
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'update']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function mockClient(fromMock: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    from: fromMock,
  } as never)
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'
const INPUT = { tenantSlug: 'viadal', tenantId: TENANT_ID, eventId: EVENT_ID }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('publishEvent', () => {
  it('redirects to /login when there is no authenticated user', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
      from: vi.fn(),
    } as never)

    await expect(publishEvent(INPUT)).rejects.toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
  })

  it('returns an authorization error and never queries events when access is denied', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const fromMock = vi.fn()
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'Not authorized' })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns an error when the event is not found for this tenant', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: null })
    const fromMock = vi.fn().mockReturnValueOnce(eventBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'Event not found.' })
    expect(eventBuilder.eq).toHaveBeenCalledWith('id', EVENT_ID)
    expect(eventBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('is a no-op success when the event is already published', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: { name: 'Viadal 2026', status: 'published' } })
    const fromMock = vi.fn().mockReturnValueOnce(eventBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({})
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns an error when the event name is empty or only whitespace', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: { name: '   ', status: 'draft' } })
    const fromMock = vi.fn().mockReturnValueOnce(eventBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'Event name is required before publishing.' })
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('returns an error when there are no Race stages', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: { name: 'Viadal 2026', status: 'draft' } })
    const stagesBuilder = chain({ count: 0 })
    const fromMock = vi.fn().mockReturnValueOnce(eventBuilder).mockReturnValueOnce(stagesBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'Add at least one Race stage before publishing.' })
    expect(stagesBuilder.eq).toHaveBeenCalledWith('event_id', EVENT_ID)
    expect(stagesBuilder.eq).toHaveBeenCalledWith('stage_type', 'race')
  })

  it('returns an error when the race stage count is null', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: { name: 'Viadal 2026', status: 'draft' } })
    const stagesBuilder = chain({ count: null })
    const fromMock = vi.fn().mockReturnValueOnce(eventBuilder).mockReturnValueOnce(stagesBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'Add at least one Race stage before publishing.' })
  })

  it('publishes the event and revalidates both admin paths on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: { name: 'Viadal 2026', status: 'draft' } })
    const stagesBuilder = chain({ count: 1 })
    const updateBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(eventBuilder)
      .mockReturnValueOnce(stagesBuilder)
      .mockReturnValueOnce(updateBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({})
    expect(updateBuilder.update).toHaveBeenCalledWith({ status: 'published' })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', EVENT_ID)
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/event')
    expect(revalidatePath).toHaveBeenCalledWith('/viadal/admin/dashboard')
  })

  it('returns the db error message and skips revalidation when the update fails', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const eventBuilder = chain({ data: { name: 'Viadal 2026', status: 'draft' } })
    const stagesBuilder = chain({ count: 1 })
    const updateBuilder = chain({ error: { message: 'db is down' } })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(eventBuilder)
      .mockReturnValueOnce(stagesBuilder)
      .mockReturnValueOnce(updateBuilder)
    mockClient(fromMock)

    const result = await publishEvent(INPUT)

    expect(result).toEqual({ error: 'db is down' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
