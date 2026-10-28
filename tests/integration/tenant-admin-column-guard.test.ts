import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createSystemAdmin,
  deleteAuthUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// B13: tenant_admin_update_own_tenant grants UPDATE on the whole tenants row,
// so guard_tenant_system_admin_columns is what stops a tenant admin from
// raising their own tier through PostgREST. Only color_palette is theirs.
describe('B13: tenant admins may change only color_palette on their tenant', () => {
  let tenant: { id: string; slug: string }
  let systemAdminId: string
  let clientTenantAdmin: Awaited<ReturnType<typeof signInAsClient>>
  let clientSystemAdmin: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenant = await createTenant('Column Guard', 'standard')
    const tenantAdmin = await createUserWithRole(tenant.id, 'tenant_admin')
    clientTenantAdmin = await signInAsClient(tenantAdmin.phone, '000000')
    const systemAdmin = await createSystemAdmin()
    systemAdminId = systemAdmin.userId
    clientSystemAdmin = await signInAsClient(systemAdmin.phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
    await deleteAuthUser(systemAdminId)
  })

  async function readTenant() {
    const { data, error } = await serviceClient()
      .from('tenants')
      .select('tier, is_active, slug, name, sms_sender_id, color_palette')
      .eq('id', tenant.id)
      .single()
    if (error) throw error
    return data
  }

  it.each([
    ['tier', { tier: 'professional' }],
    ['is_active', { is_active: false }],
    ['slug', { slug: 'hijacked-slug' }],
    ['name', { name: 'Hijacked' }],
    ['sms_sender_id', { sms_sender_id: 'Hijacked' }],
    ['feature_flags', { feature_flags: { anything: true } }],
  ])('rejects a tenant admin changing %s', async (_column, patch) => {
    const before = await readTenant()
    const { error } = await clientTenantAdmin.from('tenants').update(patch).eq('id', tenant.id)
    expect(error?.code).toBe('42501')
    expect(await readTenant()).toEqual(before)
  })

  it('rejects a change smuggled in alongside color_palette', async () => {
    const { error } = await clientTenantAdmin
      .from('tenants')
      .update({ color_palette: 'green', tier: 'professional' })
      .eq('id', tenant.id)
    expect(error?.code).toBe('42501')
    expect((await readTenant()).tier).toBe('standard')
  })

  it('lets a tenant admin change color_palette', async () => {
    const { error } = await clientTenantAdmin
      .from('tenants')
      .update({ color_palette: 'green' })
      .eq('id', tenant.id)
    expect(error).toBeNull()
    expect((await readTenant()).color_palette).toBe('green')
  })

  it('lets a tenant admin rewrite other columns with their current values', async () => {
    const current = await readTenant()
    const { error } = await clientTenantAdmin
      .from('tenants')
      .update({ color_palette: current.color_palette, tier: current.tier, name: current.name })
      .eq('id', tenant.id)
    expect(error).toBeNull()
  })

  it('lets a system admin change tier, is_active and sms_sender_id', async () => {
    const { error } = await clientSystemAdmin
      .from('tenants')
      .update({ tier: 'premium', is_active: false, sms_sender_id: 'Guarded' })
      .eq('id', tenant.id)
    expect(error).toBeNull()
    const after = await readTenant()
    expect(after.tier).toBe('premium')
    expect(after.is_active).toBe(false)
    expect(after.sms_sender_id).toBe('Guarded')
  })

  it('lets the service role change tier', async () => {
    const { error } = await serviceClient()
      .from('tenants')
      .update({ tier: 'professional' })
      .eq('id', tenant.id)
    expect(error).toBeNull()
    expect((await readTenant()).tier).toBe('professional')
  })
})
