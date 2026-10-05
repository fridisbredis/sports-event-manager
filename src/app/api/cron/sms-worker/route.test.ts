import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import twilio from 'twilio'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

// The failure paths below assert on the *shape* logQueryError writes
// (op/table/kind/consequence), which is what a Log Analytics query selects on.
// Spying on console.error would only prove something was printed.
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

/**
 * The worker hits `announcements` and `sms_queue` more than once each, for a
 * different purpose every time: announcements is read for bodies and then
 * updated during reconcile; sms_queue is updated per row and then counted per
 * announcement. Route by table *and* call order so a test can fail exactly one
 * of them — counting calls inline (the earlier style here) stops working as
 * soon as a case needs the second sms_queue builder to differ from the first.
 */
function serviceWith(builders: {
  rpc: ReturnType<typeof vi.fn>
  announcements?: Record<string, unknown>[]
  smsQueue?: Record<string, unknown>[]
}) {
  const used: Record<string, number> = { announcements: 0, sms_queue: 0 }
  const from = vi.fn((table: string) => {
    const list = table === 'announcements' ? builders.announcements : builders.smsQueue
    const index = used[table] ?? 0
    used[table] = index + 1
    // Past the end, reuse the last builder: the per-row update and the
    // per-announcement count each repeat for every row/announcement.
    const picked = list?.[Math.min(index, list.length - 1)]
    return picked ?? chain({ error: null })
  })
  return { from, rpc: builders.rpc }
}

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/cron/sms-worker', {
    method: 'POST',
    headers,
  })
}

const AUTHED = { Authorization: 'Bearer secret-value' }

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q1',
    tenant_id: 't1',
    announcement_id: 'ann-1',
    recipient_phone: '46701111111',
    status: 'sending',
    attempts: 0,
    last_error: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = 'secret-value'
  process.env.TWILIO_ACCOUNT_SID = 'AC_test'
  process.env.TWILIO_AUTH_TOKEN = 'token_test'
  process.env.TWILIO_PHONE_NUMBER = '+15550001111'
  messagesCreate.mockResolvedValue({})
  vi.mocked(twilio).mockReturnValue({ messages: { create: messagesCreate } } as never)
})

describe('POST /api/cron/sms-worker', () => {
  it('returns 401 when the CRON_SECRET header is missing or wrong', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET env var is unset (fails closed)', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest(AUTHED))
    expect(res.status).toBe(401)
  })

  it('claims a batch, sends each row, and marks them sent', async () => {
    const claimedRows = [
      queueRow({ id: 'q1' }),
      queueRow({ id: 'q2', recipient_phone: '46702222222' }),
    ]
    const rpc = vi.fn().mockResolvedValue({ data: claimedRows, error: null })
    const announcementsBuilder = chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })
    const queueUpdateBuilder = chain({ error: null })
    const reconcileCountBuilder = chain({ count: 2, error: null })
    const announcementUpdateBuilder = chain({ error: null })

    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceWith({
        rpc,
        announcements: [announcementsBuilder, announcementUpdateBuilder],
        smsQueue: [queueUpdateBuilder, queueUpdateBuilder, reconcileCountBuilder],
      }) as never
    )

    const res = await POST(makeRequest(AUTHED))
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

    const res = await POST(makeRequest(AUTHED))
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 0, retried: 0 })
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('retries a row under MAX_ATTEMPTS by resetting status to pending', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
    const queueUpdateBuilder = chain({ error: null })

    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceWith({
        rpc,
        announcements: [chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })],
        smsQueue: [queueUpdateBuilder, chain({ count: 0, error: null })],
      }) as never
    )

    messagesCreate.mockRejectedValue({ code: 21211 })

    const res = await POST(makeRequest(AUTHED))
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 0, retried: 1 })
    expect(queueUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', attempts: 1 })
    )
  })

  it('marks a row failed once attempts reach MAX_ATTEMPTS', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [queueRow({ attempts: 2 })], error: null })
    const queueUpdateBuilder = chain({ error: null })

    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceWith({
        rpc,
        announcements: [chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })],
        smsQueue: [queueUpdateBuilder, chain({ count: 0, error: null })],
      }) as never
    )

    messagesCreate.mockRejectedValue({ code: 21211 })

    const res = await POST(makeRequest(AUTHED))
    const body = await res.json()

    expect(body).toEqual({ sent: 0, failed: 1, retried: 0 })
    expect(queueUpdateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', attempts: 3 })
    )
  })

  // The cases below are the unattended-failure half of this route. The job runs
  // on pg_cron every minute with nobody watching it, so these tests are the
  // only thing asserting the failure paths behave — a regression in any of them
  // is silent in production until an admin notices SMS that never arrived.
  describe('configuration failures', () => {
    it('returns 500 without claiming anything when TWILIO_PHONE_NUMBER is unset', async () => {
      delete process.env.TWILIO_PHONE_NUMBER

      const res = await POST(makeRequest(AUTHED))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'SMS is not configured' })
      // Must fail before claiming: a claim flips rows to 'sending', and with no
      // from-number to send them they would sit there until reclaimed.
      expect(createSupabaseServiceClient).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        'SMS worker blocked: TWILIO_PHONE_NUMBER is not set'
      )
    })

    it('returns 500 when the Twilio client cannot be constructed', async () => {
      // Thrown by twilio() itself on a malformed/absent account SID, which is
      // what an unset TWILIO_ACCOUNT_SID looks like at runtime.
      const constructorError = new Error('accountSid must start with AC')
      vi.mocked(twilio).mockImplementation(() => {
        throw constructorError
      })

      const res = await POST(makeRequest(AUTHED))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'SMS is not configured' })
      expect(createSupabaseServiceClient).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        'SMS worker blocked: Twilio client could not be constructed',
        constructorError
      )
    })
  })

  describe('claim failure', () => {
    it('returns 500 and sends nothing when claim_sms_queue_batch errors', async () => {
      const claimError = { code: '42883', message: 'function does not exist' }
      const rpc = vi.fn().mockResolvedValue({ data: null, error: claimError })
      vi.mocked(createSupabaseServiceClient).mockReturnValue({
        from: vi.fn(),
        rpc,
      } as never)

      const res = await POST(makeRequest(AUTHED))

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'Failed to claim queue batch' })
      expect(messagesCreate).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        'SMS worker failed to claim queue batch',
        claimError
      )
    })
  })

  describe('missing announcement body', () => {
    it('never sends a blank SMS, and routes the row through retry instead', async () => {
      // The announcement row is gone (deleted between queueing and this tick),
      // so bodyById has no entry for it. Before the guard this sent `?? ''` —
      // a blank SMS the recipient cannot unsend, marked 'sent' with no retry.
      const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
      const queueUpdateBuilder = chain({ error: null })

      vi.mocked(createSupabaseServiceClient).mockReturnValue(
        serviceWith({
          rpc,
          announcements: [chain({ data: [], error: null })],
          smsQueue: [queueUpdateBuilder, chain({ count: 0, error: null })],
        }) as never
      )

      const res = await POST(makeRequest(AUTHED))
      const body = await res.json()

      expect(messagesCreate).not.toHaveBeenCalled()
      expect(body).toEqual({ sent: 0, failed: 0, retried: 1 })
      // Follows the ordinary failure path: attempts incremented, back to
      // pending for the next tick, last_error 'none' because this is our own
      // error rather than a Twilio one with a numeric code.
      expect(queueUpdateBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', attempts: 1, last_error: 'none' })
      )
    })

    it('treats an empty-string body the same as a missing row', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
      const queueUpdateBuilder = chain({ error: null })

      vi.mocked(createSupabaseServiceClient).mockReturnValue(
        serviceWith({
          rpc,
          announcements: [chain({ data: [{ id: 'ann-1', body: '' }], error: null })],
          smsQueue: [queueUpdateBuilder, chain({ count: 0, error: null })],
        }) as never
      )

      const body = await (await POST(makeRequest(AUTHED))).json()

      expect(messagesCreate).not.toHaveBeenCalled()
      expect(body).toEqual({ sent: 0, failed: 0, retried: 1 })
    })
  })

  describe('mark-sent failure after a successful send', () => {
    it('logs row_stuck_sending_after_successful_send and still counts the send', async () => {
      // Twilio accepted the message but the row never left 'sending'. Nothing
      // can roll the SMS back, so the log line is the only record that this
      // row will be redelivered or stall — it has to carry the consequence.
      const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
      const markSentError = { code: '40001', message: 'could not serialize access' }

      vi.mocked(createSupabaseServiceClient).mockReturnValue(
        serviceWith({
          rpc,
          announcements: [
            chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null }),
            chain({ error: null }),
          ],
          smsQueue: [chain({ error: markSentError }), chain({ count: 1, error: null })],
        }) as never
      )

      const body = await (await POST(makeRequest(AUTHED))).json()

      expect(messagesCreate).toHaveBeenCalledTimes(1)
      // Counted as sent: the SMS did go out, whatever the row says.
      expect(body).toEqual({ sent: 1, failed: 0, retried: 0 })
      expect(logger.error).toHaveBeenCalledWith(
        'GET /api/cron/sms-worker: update on sms_queue failed',
        markSentError,
        expect.objectContaining({
          op: 'GET /api/cron/sms-worker',
          table: 'sms_queue',
          kind: 'update',
          pgCode: '40001',
          tenantId: 't1',
          announcementId: 'ann-1',
          consequence: 'row_stuck_sending_after_successful_send',
        })
      )
    })
  })

  describe('mark-failed failure after a failed send', () => {
    it('logs attempt_count_not_recorded and still counts the retry', async () => {
      // The send failed and the bookkeeping write failed too, so the
      // incremented attempt count never reached the row. It returns to the
      // pool with its old `attempts` and can outlive MAX_ATTEMPTS — retrying
      // a number Twilio already rejected, forever. Nothing throws, so this
      // log line is the only trace.
      const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
      const markFailedError = { code: '40001', message: 'could not serialize access' }

      vi.mocked(createSupabaseServiceClient).mockReturnValue(
        serviceWith({
          rpc,
          announcements: [chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null })],
          smsQueue: [chain({ error: markFailedError }), chain({ count: 0, error: null })],
        }) as never
      )

      messagesCreate.mockRejectedValue({ code: 21211 })

      const body = await (await POST(makeRequest(AUTHED))).json()

      // The counters track what this tick did, not what the table records.
      expect(body).toEqual({ sent: 0, failed: 0, retried: 1 })
      expect(logger.error).toHaveBeenCalledWith(
        'GET /api/cron/sms-worker: update on sms_queue failed',
        markFailedError,
        expect.objectContaining({
          op: 'GET /api/cron/sms-worker',
          table: 'sms_queue',
          kind: 'update',
          pgCode: '40001',
          tenantId: 't1',
          announcementId: 'ann-1',
          consequence: 'attempt_count_not_recorded',
        })
      )
    })
  })

  describe('reconcile', () => {
    it('skips an announcement whose count fails rather than reading it as zero', async () => {
      // A failed count is not zero. Treated as zero it would leave sms_sent
      // false on an announcement that did go out — which is what COMM-01
      // shows the admin.
      const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
      const countError = { code: '57014', message: 'statement timeout' }
      const announcementUpdateBuilder = chain({ error: null })

      vi.mocked(createSupabaseServiceClient).mockReturnValue(
        serviceWith({
          rpc,
          announcements: [
            chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null }),
            announcementUpdateBuilder,
          ],
          // A non-null count *alongside* the error is what makes this test bite:
          // with `count: null` the `if (count && count > 0)` below is falsy on
          // its own, so the update would be skipped even without the `continue`
          // and the test would pass against a route that had lost it.
          smsQueue: [chain({ error: null }), chain({ count: 5, error: countError })],
        }) as never
      )

      const body = await (await POST(makeRequest(AUTHED))).json()

      // `continue`, not a fall-through into the update: sms_sent must be left
      // alone rather than written from a count we do not have.
      expect(announcementUpdateBuilder.update).not.toHaveBeenCalled()
      // The tick itself still succeeds — the send already happened.
      expect(body).toEqual({ sent: 1, failed: 0, retried: 0 })
      expect(logger.error).toHaveBeenCalledWith(
        'GET /api/cron/sms-worker: select on sms_queue failed',
        countError,
        expect.objectContaining({
          op: 'GET /api/cron/sms-worker',
          table: 'sms_queue',
          kind: 'select',
          pgCode: '57014',
          announcementId: 'ann-1',
          stage: 'reconcile_count',
        })
      )
    })

    it('logs a failed sms_sent update with the reconcile stage', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: [queueRow()], error: null })
      const reconcileError = { code: '42501', message: 'new row violates row-level security' }

      vi.mocked(createSupabaseServiceClient).mockReturnValue(
        serviceWith({
          rpc,
          announcements: [
            chain({ data: [{ id: 'ann-1', body: 'Hej!' }], error: null }),
            chain({ error: reconcileError }),
          ],
          smsQueue: [chain({ error: null }), chain({ count: 1, error: null })],
        }) as never
      )

      const body = await (await POST(makeRequest(AUTHED))).json()

      // Reconcile is bookkeeping after the fact — a failure there must not
      // change the tick's reported counts.
      expect(body).toEqual({ sent: 1, failed: 0, retried: 0 })
      expect(logger.error).toHaveBeenCalledWith(
        'GET /api/cron/sms-worker: update on announcements failed',
        reconcileError,
        expect.objectContaining({
          op: 'GET /api/cron/sms-worker',
          table: 'announcements',
          kind: 'update',
          pgCode: '42501',
          announcementId: 'ann-1',
          stage: 'reconcile_sms_sent',
        })
      )
    })
  })
})
