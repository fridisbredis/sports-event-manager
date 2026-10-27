import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from './route'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import twilio from 'twilio'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServiceClient: vi.fn(),
}))

const messagesCreate = vi.fn()
vi.mock('twilio', () => ({
  default: vi.fn(() => ({ messages: { create: messagesCreate } })),
}))

vi.mock('@/lib/sms/usage', () => ({
  recordSmsUsage: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'not', 'is', 'eq', 'in', 'update']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

// Long enough ago to be past the 23-month warning cutoff.
const LONG_AGO = new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString()

function official(id: string, tenantId: string, phone: string) {
  return { id, tenant_id: tenantId, name: 'Anna', phone, user_id: `user-${id}`, sms_opt_out: false }
}

function serviceWith({
  officials,
  tenants,
}: {
  officials: Record<string, unknown>[]
  tenants: { data?: Record<string, unknown>[]; error?: unknown }
}) {
  const from = vi.fn((table: string) => {
    if (table === 'officials') return chain({ data: officials, error: null })
    if (table === 'participants') return chain({ data: [], error: null })
    if (table === 'tenants')
      return chain({ data: tenants.data ?? null, error: tenants.error ?? null })
    return chain({ error: null })
  })
  const rpc = vi.fn().mockResolvedValue({ data: LONG_AGO, error: null })
  return { from, rpc }
}

function makeRequest() {
  return new NextRequest('http://localhost/api/cron/gdpr-warning', {
    method: 'POST',
    headers: { Authorization: 'Bearer secret-value' },
  })
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

// N13: the warning goes out from the person's own tenant's sender.
describe('POST /api/cron/gdpr-warning — N13 sender', () => {
  it('sends a Professional tenant from its name and a Premium tenant from the platform number', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceWith({
        officials: [official('o1', 't1', '46701111111'), official('o2', 't2', '46702222222')],
        tenants: {
          data: [
            { id: 't1', tier: 'professional', sms_sender_id: 'Viadal' },
            { id: 't2', tier: 'premium', sms_sender_id: 'Micke' },
          ],
        },
      }) as never
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+46701111111', from: 'Viadal' })
    )
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+46702222222', from: '+15550001111' })
    )
  })

  // A GDPR warning from the platform number beats one that never goes out.
  it('still sends, from the platform number, when the tenants cannot be read', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(
      serviceWith({
        officials: [official('o1', 't1', '46701111111')],
        tenants: { error: { message: 'tenants unreadable' } },
      }) as never
    )

    const res = await POST(makeRequest())

    expect(res.status).toBe(200)
    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '+46701111111', from: '+15550001111' })
    )
  })
})
