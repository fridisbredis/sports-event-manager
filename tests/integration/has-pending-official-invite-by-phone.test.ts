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

  // PR #175 review: pins a deliberate decision, not an oversight. This
  // function stays a routing hint only — confirm_official_invite_by_phone
  // (the RPC) is the real boundary and is the one that now enforces
  // invite_token_expires_at (20260910120830). So an expired invite still
  // routes to /confirm-invite; the RPC underneath is what then rejects it
  // with 'expired'. If this ever needs to change to filter out expired
  // invites at the routing-hint level too, that's a product decision to
  // make explicitly, not a side effect of an unrelated RPC fix.
  it('returns true even when invite_token_expires_at has passed (routing hint only — the RPC enforces expiry)', async () => {
    const admin = serviceClient()
    const tenant = await createTenant('Pending Invite Expired Token')
    createdTenantIds.push(tenant.id)
    const phone = `+46703${Math.floor(Math.random() * 1_000_000)}`

    const { error: insertError } = await admin.from('officials').insert({
      tenant_id: tenant.id,
      name: 'Expired Invite Official',
      phone,
      invite_status: 'invited',
      invite_token_expires_at: new Date(Date.now() - 1000).toISOString(),
    })
    if (insertError) throw insertError

    expect(await hasPendingOfficialInviteByPhone(phone)).toBe(true)
  })
})
