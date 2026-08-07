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
  builder.insert = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.upsert = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.single = vi.fn(() => Promise.resolve(result))
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/officials', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

describe('POST /api/officials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
    process.env.TWILIO_ACCOUNT_SID = 'AC_test'
    process.env.TWILIO_AUTH_TOKEN = 'token_test'
    process.env.TWILIO_PHONE_NUMBER = '+15550001111'
  })

  it('returns 400 for invalid input without checking auth or sending sms', async () => {
    const res = await POST(makeRequest({ tenantId: 'not-a-uuid', name: '', phone: '' }))

    expect(res.status).toBe(400)
    expect(requireTenantAdmin).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('returns the tenant admin auth error without inserting or sending sms', async () => {
    const errorResponse = { status: 403 }
    vi.mocked(requireTenantAdmin).mockResolvedValue({ error: errorResponse } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567' }))

    expect(res).toBe(errorResponse)
    expect(createSupabaseServiceClient).not.toHaveBeenCalled()
    expect(messagesCreate).not.toHaveBeenCalled()
  })

  it('validates tenantId via requireTenantAdmin before creating the invite', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({ user: { id: 'admin-1' }, role: 'tenant_admin' } as never)
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(chain({ data: { id: 'off-1', invite_token: 'tok-abc' }, error: null }))
    fromMock.mockReturnValueOnce(chain({ data: { name: 'Viadal 2026' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567' }))

    expect(requireTenantAdmin).toHaveBeenCalledWith(TENANT_ID)
  })

  it('normalizes the phone, inserts the official, and sends the invite SMS with the confirmation text', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({ user: { id: 'admin-1' }, role: 'tenant_admin' } as never)

    const official = {
      id: 'off-1',
      tenant_id: TENANT_ID,
      name: 'Anna',
      phone: '0701234567',
      invite_status: 'invited',
      invite_token: 'tok-abc',
    }

    const officialsBuilder = chain({ data: official, error: null })
    const tenantsBuilder = chain({ data: { name: 'Viadal 2026' } })
    const fromMock = vi.fn()
    fromMock.mockReturnValueOnce(officialsBuilder).mockReturnValueOnce(tenantsBuilder)
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '070-123 45 67' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.official).toEqual(official)

    expect(officialsBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: TENANT_ID,
        name: 'Anna',
        phone: '0701234567',
        invite_status: 'invited',
      })
    )

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(messagesCreate).toHaveBeenCalledWith({
      body: 'Hi Anna, you have been invited as an official for Viadal 2026. Confirm your availability here: https://app.example.com/invite/tok-abc',
      from: '+15550001111',
      to: '0701234567',
    })
  })

  it('falls back to "an event" in the confirmation text when the tenant has no name', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({ user: { id: 'admin-1' }, role: 'tenant_admin' } as never)

    const official = { id: 'off-1', name: 'Bo', phone: '0709998877', invite_token: 'tok-xyz' }
    const fromMock = vi.fn()
    fromMock
      .mockReturnValueOnce(chain({ data: official, error: null }))
      .mockReturnValueOnce(chain({ data: null }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    await POST(makeRequest({ tenantId: TENANT_ID, name: 'Bo', phone: '0709998877' }))

    expect(messagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'Hi Bo, you have been invited as an official for an event. Confirm your availability here: https://app.example.com/invite/tok-xyz',
      })
    )
  })

  it('returns 500 and never sends sms when the insert fails', async () => {
    vi.mocked(requireTenantAdmin).mockResolvedValue({ user: { id: 'admin-1' }, role: 'tenant_admin' } as never)
    const fromMock = vi.fn().mockReturnValueOnce(chain({ data: null, error: { message: 'boom' } }))
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: fromMock } as never)

    const res = await POST(makeRequest({ tenantId: TENANT_ID, name: 'Anna', phone: '0701234567' }))

    expect(res.status).toBe(500)
    expect(messagesCreate).not.toHaveBeenCalled()
  })
})
