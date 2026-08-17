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
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/officials/off-1/resend', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

describe('POST /api/officials/[id]/resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_PHONE_NUMBER = '+15550001111'
  })

  it('returns 400 for invalid input without checking auth or sending sms', async () => {
    const res = await POST(makeRequest({ tenantId: 'not-a-uuid' }), makeParams('off-1'))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns the tenant admin auth error without touching the db or sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('validates tenantId via requireTenantAdmin and scopes the official lookup to that tenant', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const officialsBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '0701234567', invite_status: 'invited' },
    })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsBuilder)
      .mockReturnValueOnce(chain({ data: { invite_token: 'tok-new' } }))
      .mockReturnValueOnce(chain({ data: { name: 'Viadal 2026' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(requireTenantAdmin).toHaveBeenCalledWith(TENANT_ID)
    expect(officialsBuilder.eq).toHaveBeenCalledWith('id', 'off-1')
    expect(officialsBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)
  })

  it('returns 404 when the official is not found', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(404)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns 400 and does not send sms when the official is not in the invited state', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn().mockReturnValueOnce(
      chain({
        data: { id: 'off-1', name: 'Anna', phone: '0701234567', invite_status: 'confirmed' },
      })
    )
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(400)
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('regenerates the invite token and resends the confirmation text via Twilio', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)

    const officialsSelectBuilder = chain({
      data: { id: 'off-1', name: 'Anna', phone: '0701234567', invite_status: 'invited' },
    })
    const officialsUpdateBuilder = chain({ data: { invite_token: 'tok-new' } })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(officialsSelectBuilder)
      .mockReturnValueOnce(officialsUpdateBuilder)
      .mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })

    // A fresh token, not the existing one: resend has to revoke the previous link rather
    // than grant it another expiry window, since it is the only rotation an admin has.
    expect(officialsUpdateBuilder.update).toHaveBeenCalledWith({
      invite_token: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      ),
      invite_token_expires_at: expect.any(String),
    })
    expect(officialsUpdateBuilder.eq).toHaveBeenCalledWith('id', 'off-1')
    expect(officialsUpdateBuilder.eq).toHaveBeenCalledWith('tenant_id', TENANT_ID)

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hi Anna, you have been invited as an official for Viadal 2026. Confirm your availability here: https://app.example.com/invite/tok-new',
      from: '+15550001111',
      to: '0701234567',
    })
  })

  it('returns 500 and never sends sms when the token refresh fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({
      user: { id: 'admin-1' },
      role: 'tenant_admin',
    } as never)
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(
        chain({
          data: { id: 'off-1', name: 'Anna', phone: '0701234567', invite_status: 'invited' },
        })
      )
      .mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID }), makeParams('off-1'))

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
  })
})
