import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.insert = vi.fn(() => builder)
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

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'token_test'
  process.env.TWILIO_PHONE_NUMBER = '+15550001111'
  messagesCreate.mockResolvedValue({})
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

  it('returns the tenant admin auth error without fetching recipients or sending sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('queries the officials table scoped to tenant_id for the officials channel', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [], error: null })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(fromMock).toHaveBeenNthCalledWith(1, 'officials')
    expect(recipientsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('queries the participants table for the participants channel', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [], error: null })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'participants', body: 'Hej!' }))

    expect(fromMock).toHaveBeenNthCalledWith(1, 'participants')
  })

  it('returns 500 and skips insert/sms when the recipients fetch fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(res.status).toBe(500)
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('inserts the announcement and sends sms to every recipient when there are no failures', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '0701111111' }, { phone: '0702222222' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(200)
    expect(responseBody).toEqual({ sent: 2, failed: 0 })

    expect(insertBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        channel: 'officials',
        body: 'Hej!',
        sms_sent: false,
      })
    )

    expect(messagesCreate).toHaveBeenCalledTimes(2)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hej!',
      from: '+15550001111',
      to: '0701111111',
    })
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hej!',
      from: '+15550001111',
      to: '0702222222',
    })
  })

  it('does not send any sms and reports 0/0 when there are no recipients', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: [], error: null })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(responseBody).toEqual({ sent: 0, failed: 0 })
    expect(messagesCreate).not.toHaveBeenCalled()
    expect(insertBuilder.insert).toHaveBeenCalled()
  })

  it('treats a null recipients result the same as an empty list', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({ data: null, error: null })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(responseBody).toEqual({ sent: 0, failed: 0 })
  })

  it('counts partial sms failures without failing the whole request', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '0701111111' }, { phone: '0702222222' }, { phone: '0703333333' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    messagesCreate.mockImplementation(({ to }: { to: string }) =>
      to === '0702222222' ? Promise.reject(new Error('invalid number')) : Promise.resolve({})
    )

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(200)
    expect(responseBody).toEqual({ sent: 2, failed: 1 })
  })
})
