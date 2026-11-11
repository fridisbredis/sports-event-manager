import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { resolveOtpSender } from './otp-sender'

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const PLATFORM = '+46700000000'
const USER = { id: '00000000-0000-4000-8000-000000000001', phone: '46701234567' }

type Result = { data: unknown; error: unknown }

const VIADAL = { id: 't1', name: 'Viadal Ultra', tier: 'professional', sms_sender_id: 'Viadal' }
const OTHER = { id: 't2', name: 'Other club', tier: 'standard', sms_sender_id: null }
const VIADAL_TWO = { id: 't3', name: 'Viadal Kids', tier: 'professional', sms_sender_id: 'Viadal' }

function fakeService(results: { user_roles: Result; officials: Result; tenants?: Result }) {
  const calls: Record<string, unknown[][]> = {}
  const from = vi.fn((table: keyof typeof results) => {
    const builder: Record<string, unknown> = {}
    const record = (name: string) =>
      vi.fn((...args: unknown[]) => {
        ;(calls[`${table}.${name}`] ??= []).push(args)
        return builder
      })
    builder.select = record('select')
    builder.eq = record('eq')
    builder.in = record('in')
    builder.then = (resolve: (r: Result) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve)
    return builder
  })
  return { service: { from } as unknown as SupabaseClient<Database>, calls }
}

const ok = (data: unknown): Result => ({ data, error: null })
const fail: Result = { data: null, error: { code: '42501', message: 'denied' } }

describe('resolveOtpSender', () => {
  it('uses the tenant name when the number belongs to one tenant with a name', async () => {
    const { service } = fakeService({
      user_roles: ok([{ tenant_id: 't1' }]),
      officials: ok([{ tenant_id: 't1' }]),
      tenants: ok([VIADAL]),
    })

    expect(await resolveOtpSender(service, USER, PLATFORM)).toEqual({
      from: 'Viadal',
      tenantName: 'Viadal Ultra',
    })
  })

  // The invite page: an invitee has no role until they confirm.
  it('finds the tenant through an officials row when the user has no role yet', async () => {
    const { service, calls } = fakeService({
      user_roles: ok([]),
      officials: ok([{ tenant_id: 't1' }]),
      tenants: ok([VIADAL]),
    })

    expect((await resolveOtpSender(service, USER, PLATFORM)).from).toBe('Viadal')
    // Both stored phone shapes are matched.
    expect(calls['officials.in']).toEqual([['phone', ['46701234567', '+46701234567']]])
  })

  it('uses the platform number for a number in two tenants with different senders', async () => {
    const { service } = fakeService({
      user_roles: ok([{ tenant_id: 't1' }, { tenant_id: 't2' }]),
      officials: ok([]),
      tenants: ok([VIADAL, OTHER]),
    })

    expect(await resolveOtpSender(service, USER, PLATFORM)).toEqual({
      from: PLATFORM,
      tenantName: null,
    })
  })

  it('uses the shared sender name when two tenants resolve to the same one', async () => {
    const { service } = fakeService({
      user_roles: ok([{ tenant_id: 't1' }, { tenant_id: 't3' }]),
      officials: ok([]),
      tenants: ok([VIADAL, VIADAL_TWO]),
    })

    expect(await resolveOtpSender(service, USER, PLATFORM)).toEqual({
      from: 'Viadal',
      tenantName: 'Viadal',
    })
  })

  // A system admin's role carries tenant_id null; a first-time claimer has nothing.
  it('uses the platform number when no tenant applies', async () => {
    const { service, calls } = fakeService({
      user_roles: ok([{ tenant_id: null }]),
      officials: ok([]),
    })

    expect((await resolveOtpSender(service, USER, PLATFORM)).from).toBe(PLATFORM)
    expect(calls['tenants.select']).toBeUndefined()
  })

  // The sender is tier-gated, the body name is not.
  it('uses the platform number but keeps the body name on a lower tier', async () => {
    const { service } = fakeService({
      user_roles: ok([{ tenant_id: 't1' }]),
      officials: ok([]),
      tenants: ok([{ ...VIADAL, tier: 'premium' }]),
    })

    expect(await resolveOtpSender(service, USER, PLATFORM)).toEqual({
      from: PLATFORM,
      tenantName: 'Viadal Ultra',
    })
  })

  it('names a single tenant that has no sender name at all', async () => {
    const { service } = fakeService({
      user_roles: ok([]),
      officials: ok([{ tenant_id: 't2' }]),
      tenants: ok([OTHER]),
    })

    expect(await resolveOtpSender(service, USER, PLATFORM)).toEqual({
      from: PLATFORM,
      tenantName: 'Other club',
    })
  })

  // Two lower-tier tenants: no shared sender name to fall back on.
  it('names no tenant for a number in two tenants without a shared sender name', async () => {
    const { service } = fakeService({
      user_roles: ok([{ tenant_id: 't2' }, { tenant_id: 't4' }]),
      officials: ok([]),
      tenants: ok([OTHER, { id: 't4', name: 'Third club', tier: 'premium', sms_sender_id: null }]),
    })

    expect(await resolveOtpSender(service, USER, PLATFORM)).toEqual({
      from: PLATFORM,
      tenantName: null,
    })
  })

  it.each([
    [
      'user_roles',
      { user_roles: fail, officials: ok([{ tenant_id: 't1' }]), tenants: ok([VIADAL]) },
    ],
    [
      'officials',
      { user_roles: ok([{ tenant_id: 't1' }]), officials: fail, tenants: ok([VIADAL]) },
    ],
    ['tenants', { user_roles: ok([{ tenant_id: 't1' }]), officials: ok([]), tenants: fail }],
  ])('falls back to the platform number when the %s read fails', async (_table, results) => {
    const { service } = fakeService(results)

    expect((await resolveOtpSender(service, USER, PLATFORM)).from).toBe(PLATFORM)
  })

  it('falls back to the platform number when a tenant row is missing', async () => {
    const { service } = fakeService({
      user_roles: ok([{ tenant_id: 't1' }, { tenant_id: 't2' }]),
      officials: ok([]),
      tenants: ok([VIADAL]),
    })

    expect((await resolveOtpSender(service, USER, PLATFORM)).from).toBe(PLATFORM)
  })
})
