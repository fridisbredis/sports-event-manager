import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/announcements', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

// Registered by the tests that stub console.error, and always undone in afterEach: an
// assertion that fails mid-test must not leave console stubbed for every test after it.
let restoreConsoleError: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  restoreConsoleError?.()
  restoreConsoleError = undefined
})

describe('POST /api/announcements', () => {
  it('returns 400 for an invalid tenantId, channel, or empty body', async () => {
    const res = await POST(makeRequest({ tenantId: 'not-a-uuid', channel: 'bogus', body: '' }))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
  })

  it('returns 400 when the message body exceeds 1600 characters', async () => {
    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'x'.repeat(1601) })
    )

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
  })

  it('returns the tenant admin auth error without fetching recipients or enqueueing sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
  })

  it('queries the officials table scoped to tenant_id for the officials channel', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [], error: null })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(fromMock).toHaveBeenNthCalledWith(1, 'officials')
    expect(recipientsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
    expect(recipientsBuilder.eq).toHaveBeenCalledWith('sms_opt_out', false)
    expect(recipientsBuilder.eq).toHaveBeenCalledWith('invite_status', 'confirmed')
    expect(recipientsBuilder.limit).toHaveBeenCalledWith(500)
  })

  it('caps the recipient query at 500 and logs when the cap is hit (F-SEC-04)', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipients = Array.from({ length: 500 }, (_, i) => ({ phone: `+4670000${i}` }))
    const recipientsBuilder = chain({ data: recipients, error: null })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const queueBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
      .mockReturnValueOnce(queueBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    restoreConsoleError = () => consoleWarnSpy.mockRestore()

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(recipientsBuilder.limit).toHaveBeenCalledWith(500)
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('hit the cap'))
  })

  it('excludes non-confirmed officials (e.g. removed) even when sms_opt_out is false', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    // Simulates the DB-level filter: only confirmed officials come back,
    // even though a removed official row with the same phone still exists
    // in the table with sms_opt_out=false.
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }],
      error: null,
    })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const queueBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
      .mockReturnValueOnce(queueBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(recipientsBuilder.eq).toHaveBeenCalledWith('invite_status', 'confirmed')
    expect(res.status).toBe(202)
    expect(responseBody).toEqual({ announcementId: 'ann-1', queued: 1 })
    expect(queueBuilder.insert).toHaveBeenCalledWith([
      { tenant_id: TENANT_ID, announcement_id: 'ann-1', recipient_phone: '46701111111' },
    ])
  })

  it('does not filter participants by invite_status (no such column)', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46702222222' }],
      error: null,
    })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const queueBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
      .mockReturnValueOnce(queueBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'participants', body: 'Hej!' }))

    expect(recipientsBuilder.eq).not.toHaveBeenCalledWith('invite_status', 'confirmed')
  })

  it('queries the participants table for the participants channel', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [], error: null })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'participants', body: 'Hej!' }))

    expect(fromMock).toHaveBeenNthCalledWith(1, 'participants')
    expect(recipientsBuilder.limit).toHaveBeenCalledWith(500)
  })

  it('returns 500 and skips insert/enqueue when the recipients fetch fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(res.status).toBe(500)
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('inserts the announcement and enqueues sms_queue rows for every recipient', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }, { phone: '46702222222' }],
      error: null,
    })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const queueBuilder = chain({ error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
      .mockReturnValueOnce(queueBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(202)
    expect(responseBody).toEqual({ announcementId: 'ann-1', queued: 2 })

    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        channel: 'officials',
        body: 'Hej!',
        sms_sent: false,
      })
    )

    expect(fromMock).toHaveBeenNthCalledWith(3, 'sms_queue')
    expect(queueBuilder.insert).toHaveBeenCalledWith([
      { tenant_id: TENANT_ID, announcement_id: 'ann-1', recipient_phone: '46701111111' },
      { tenant_id: TENANT_ID, announcement_id: 'ann-1', recipient_phone: '46702222222' },
    ])
  })

  it('does not touch sms_queue when there are no recipients', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [], error: null })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(202)
    expect(responseBody).toEqual({ announcementId: 'ann-1', queued: 0 })
    expect(fromMock).toHaveBeenCalledTimes(2)
  })

  it('returns 500 when enqueueing sms_queue rows fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [{ phone: '46701111111' }], error: null })
    const insertBuilder = chain({ data: { id: 'ann-1' }, error: null })
    const queueBuilder = chain({ error: { message: 'boom' } })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
      .mockReturnValueOnce(queueBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(res.status).toBe(500)
  })
})
