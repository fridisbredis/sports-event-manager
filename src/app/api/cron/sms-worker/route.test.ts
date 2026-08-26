import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServiceClient } from '@/lib/supabase/server'

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
  builder.in = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/sms-worker', {
    method: 'POST',
    headers,
  })
}

let restoreConsoleError: (() => void) | undefined

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'secret-value'
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'token_test'
  process.env.TWILIO_PHONE_NUMBER = '+15550001111'
  messagesCreate.mockResolvedValue({})
})

afterEach(() => {
  restoreConsoleError?.()
  restoreConsoleError = undefined
})

describe('POST /api/cron/sms-worker', () => {
  it('returns 401 when the CRON_SECRET header is missing or wrong', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET env var is unset (fails closed)', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ Authorization: 'Bearer secret-value' }))
    expect(res.status).toBe(401)
  })

  it('claims a batch, sends each row, and marks them sent', async () => {
    const claimedRows = [
      {
        id: 'q1',
        tenant_id: 't1',
        announcement_id: 'ann-1',
        recipient_phone: '46701111111',
        status: 'sending',
        attempts: 0,
        last_error: null,
      },
      {
        id: 'q2',
        tenant_id: 't1',
        announcement_id: 'ann-1',
        recipient_phone: '46702222222',
        status: 'sending',
        attempts: 0,
        last_error: null,
      },
    ]
    const rpc = vi.fn().mockResolvedValue({ data: claimedRows, error: null })
    const announcementsBuilder = chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })
    const queueUpdateBuilder = chain({ error: null })
    const reconcileCountBuilder = chain({ count: 2, error: null })
    const announcementUpdateBuilder = chain({ error: null })

    const fromMock = vi.fn((table: string) => {
      if (table === 'announcements') {
        // First call selects body, second (reconcile) updates sms_sent
        return fromMock.mock.calls.filter((c) => c[0] === 'announcements').length === 1
          ? announcementsBuilder
          : announcementUpdateBuilder
      }
      if (table === 'sms_queue') {
        return fromMock.mock.calls.filter((c) => c[0] === 'sms_queue').length === 1
          ? queueUpdateBuilder
          : reconcileCountBuilder
      }
      return chain({ error: null })
    })

    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock, rpc } as never)

    const res = await POST(makeRequest({ Authorization: 'Bearer secret-value' }))
    const body = await res.json()

    expect(rpc).toHaveBeenCalledWith('claim_sms_queue_batch', { p_batch_size: 100 })
    expect(messagesCreate).toHaveBeenCalledTimes(2)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hej!',
      from: '+15550001111',
      to: '+46701111111',
    })
    expect(body).toEqual({ sent: 2, failed: 0, retried: 0 })
  })

  it('returns zero counts without sending when the queue is empty', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(),
      rpc,
    } as never)

    const res = await POST(makeRequest({ Authorization: 'Bearer secret-value' }))
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 0, retried: 0 })
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('retries a row under MAX_ATTEMPTS by resetting status to pending', async () => {
    const claimedRows = [
      {
        id: 'q1',
        tenant_id: 't1',
        announcement_id: 'ann-1',
        recipient_phone: '46701111111',
        status: 'sending',
        attempts: 0,
        last_error: null,
      },
    ]
    const rpc = vi.fn().mockResolvedValue({ data: claimedRows, error: null })
    const announcementsBuilder = chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })
    const queueUpdateBuilder = chain({ error: null })
    const reconcileCountBuilder = chain({ count: 0, error: null })

    const fromMock = vi.fn((table: string) => {
      if (table === 'announcements') return announcementsBuilder
      return fromMock.mock.calls.filter((c) => c[0] === 'sms_queue').length === 1
        ? queueUpdateBuilder
        : reconcileCountBuilder
    })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock, rpc } as never)

    messagesCreate.mockRejectedValue({ code: 21211 })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ Authorization: 'Bearer secret-value' }))
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 0, retried: 1 })
    expect(queueUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', attempts: 1 })
    )
  })

  it('marks a row failed once attempts reach MAX_ATTEMPTS', async () => {
    const claimedRows = [
      {
        id: 'q1',
        tenant_id: 't1',
        announcement_id: 'ann-1',
        recipient_phone: '46701111111',
        status: 'sending',
        attempts: 2,
        last_error: '21211',
      },
    ]
    const rpc = vi.fn().mockResolvedValue({ data: claimedRows, error: null })
    const announcementsBuilder = chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })
    const queueUpdateBuilder = chain({ error: null })
    const reconcileCountBuilder = chain({ count: 0, error: null })

    const fromMock = vi.fn((table: string) => {
      if (table === 'announcements') return announcementsBuilder
      return fromMock.mock.calls.filter((c) => c[0] === 'sms_queue').length === 1
        ? queueUpdateBuilder
        : reconcileCountBuilder
    })
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock, rpc } as never)

    messagesCreate.mockRejectedValue({ code: 21211 })

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    restoreConsoleError = () => consoleErrorSpy.mockRestore()

    const res = await POST(makeRequest({ Authorization: 'Bearer secret-value' }))
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 1, retried: 0 })
    expect(queueUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', attempts: 3 })
    )
  })
})
