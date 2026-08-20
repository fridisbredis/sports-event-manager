import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import twilio from 'twilio'

vi.mock('@/lib/auth/tenant', () => ({
  requireTenantAdmin: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
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
  builder.limit = vi.fn(() => builder)
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
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'token_test'
  process.env.TWILIO_PHONE_NUMBER = '+15550001111'
  messagesCreate.mockResolvedValue({})
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

  it('returns the tenant admin auth error without fetching recipients or sending sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServerClient).not.toHaveBeenCalled()
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
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))

    expect(recipientsBuilder.limit).toHaveBeenCalledWith(500)
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('hit the 500 cap'))
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
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(recipientsBuilder.eq).toHaveBeenCalledWith('invite_status', 'confirmed')
    expect(responseBody).toEqual({ sent: 1, failed: 0 })
    expect(messagesCreate).toHaveBeenCalledTimes(1)
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
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
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
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, channel: 'participants', body: 'Hej!' }))

    expect(fromMock).toHaveBeenNthCalledWith(1, 'participants')
    expect(recipientsBuilder.limit).toHaveBeenCalledWith(500)
  })

  it('returns 500 and skips insert/sms when the recipients fetch fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

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
      data: [{ phone: '46701111111' }, { phone: '46702222222' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

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
      to: '+46701111111',
    })
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hej!',
      from: '+15550001111',
      to: '+46702222222',
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
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

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
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(responseBody).toEqual({ sent: 0, failed: 0 })
  })

  it('honours sms_opt_out for officials: filters the query and never sends to opted-out numbers', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    // Simulates the DB-level filter: only non-opted-out officials come back.
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(fromMock).toHaveBeenNthCalledWith(1, 'officials')
    expect(recipientsBuilder.eq).toHaveBeenCalledWith('sms_opt_out', false)
    expect(responseBody).toEqual({ sent: 1, failed: 0 })
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hej!',
      from: '+15550001111',
      to: '+46701111111',
    })
    // The opted-out number must never appear as a send target.
    expect(messagesCreate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '+46709999999' }))
  })

  it('honours sms_opt_out for participants: filters the query and never sends to opted-out numbers', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46702222222' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(
      makeRequest({ tenantId: TENANT_ID, channel: 'participants', body: 'Hej!' })
    )
    const responseBody = await res.json()

    expect(fromMock).toHaveBeenNthCalledWith(1, 'participants')
    expect(recipientsBuilder.eq).toHaveBeenCalledWith('sms_opt_out', false)
    expect(responseBody).toEqual({ sent: 1, failed: 0 })
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).not.toHaveBeenCalledWith(expect.objectContaining({ to: '+46708888888' }))
  })

  it('counts partial sms failures without failing the whole request', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }, { phone: '46702222222' }, { phone: '46703333333' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    messagesCreate.mockImplementation(({ to }: { to: string }) =>
      to === '+46702222222' ? Promise.reject(new Error('invalid number')) : Promise.resolve({})
    )

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(200)
    expect(responseBody).toEqual({ sent: 2, failed: 1 })
  })

  it('does not double-prefix a recipient phone that already has a leading +', async () => {
    // Legacy officials.phone rows (pre-normalization-migration) can already carry a
    // leading '+'. toTwilioE164 must pass those through unchanged rather than producing
    // the nonsense '++...'.
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '+46703333333' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(200)
    expect(responseBody).toEqual({ sent: 1, failed: 0 })
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hej!',
      from: '+15550001111',
      to: '+46703333333',
    })
  })

  it('returns a controlled 500 instead of escaping the handler when twilio() throws synchronously', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    vi.mocked(twilio).mockImplementationOnce(() => {
      throw new Error('accountSid must start with AC')
    })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(500)
    expect(responseBody).toEqual({ error: 'SMS is not configured' })
    expect(messagesCreate).not.toHaveBeenCalled()

    // The announcement row stays: it was written with sms_sent: false, which is exactly
    // what happened. Rolling it back is deliberately out of scope here.
    expect(insertBuilder.insert).toHaveBeenCalled()
  })

  it('returns 500 and sends nothing when TWILIO_PHONE_NUMBER is unset', async () => {
    delete process.env.TWILIO_PHONE_NUMBER

    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(500)
    expect(responseBody).toEqual({ error: 'SMS is not configured' })
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('logs each failed send with the twilio code only, never the raw error or the number', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const recipientsBuilder = chain({
      data: [{ phone: '46701111111' }, { phone: '46702222222' }],
      error: null,
    })
    const insertBuilder = chain({ data: null, error: null })
    const fromMock = vi
      .fn()
      .mockReturnValueOnce(recipientsBuilder)
      .mockReturnValueOnce(insertBuilder)
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: fromMock } as never)

    // A real Twilio rejection quotes the destination number back in its message, which is
    // exactly why the raw error must never reach the log.
    messagesCreate.mockImplementation(({ to }: { to: string }) =>
      to === '+46702222222'
        ? Promise.reject(
            Object.assign(new Error('Invalid To number: +46702222222'), { code: 21211 })
          )
        : Promise.resolve({})
    )

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ tenantId: TENANT_ID, channel: 'officials', body: 'Hej!' }))
    const responseBody = await res.json()

    expect(res.status).toBe(200)
    expect(responseBody).toEqual({ sent: 1, failed: 1 })

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const loggedMessage = consoleErrorSpy.mock.calls[0][0] as string
    expect(loggedMessage).toContain(TENANT_ID)
    expect(loggedMessage).toContain('21211')
    expect(loggedMessage).not.toContain('46702222222')
    expect(loggedMessage).not.toContain('Invalid To number')
  })
})
