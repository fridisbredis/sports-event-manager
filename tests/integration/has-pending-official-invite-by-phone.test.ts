import { describe, it, expect, afterAll } from 'vitest'
import { hasPendingOfficialInviteByPhone } from '@/lib/auth/tenant'
import { serviceClient, createTenant } from './helpers'

// Regression coverage for the unreachable-lookup fix: this function gated
// whether page.tsx even redirects a freshly-logged-in official to
// /confirm-invite. It previously required invite_status = 'invited' AND
// invite_token IS NULL — a combination no code path ever produces, since
// officials.invite_token defaults to a real UUID at creation (migration
// 0010). A mocked unit test can assert this function returns true/false for
// an arbitrary mocked query result, but it cannot prove the real filter
// chain matches an official row as actually created by the app — only this
// integration test, against real Postgres, can.
describe('hasPendingOfficialInviteByPhone (real Postgres)', () => {
  const createdTenantIds: string[] = []

  afterAll(async () => {
    const admin = serviceClient()
    if (createdTenantIds.length > 0) {
      await admin.from('tenants').delete().in('id', createdTenantIds)
    }
  })

  it('returns true for an official created the real way, with a live invite_token', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('Pending Invite Real Token')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`

    const { data: official, error } = await admin
      .from('officials')
      .insert({
        tenant_id: tenant.id,
        name: 'Real Flow Official',
        phone,
        invite_status: 'invited',
      })
      .select()
      .single()
    if (error) throw error
    expect(official.invite_token).not.toBeNull()

    expect(await hasPendingOfficialInviteByPhone(phone)).toBe(true)
  })

  it('returns false once the official is confirmed', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('Pending Invite Confirmed')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`

    const { error: insertError } = await admin.from('officials').insert({
      tenant_id: tenant.id,
      name: 'Confirmed Official',
      phone,
      invite_status: 'confirmed',
    })
    if (insertError) throw insertError

    expect(await hasPendingOfficialInviteByPhone(phone)).toBe(false)
  })

  it('returns false when no official row exists for the phone', async () => {
    expect(await hasPendingOfficialInviteByPhone('+46709999999')).toBe(false)
  })
})
