import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

describe('SEC-01: tenant isolation on officials', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let officialB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Officials')
    tenantB = await createTenant('Tenant B Officials')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const admin = serviceClient()
    const { data, error } = await admin
      .from('officials')
      .insert({ tenant_id: tenantB.id, name: 'Tenant B Official', phone: '+46709000001' })
      .select()
      .single()
    if (error) throw error
    officialB = data
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('cannot read tenant B officials', async () => {
    const { data, error } = await clientAdminA
      .from('officials')
      .select('*')
      .eq('tenant_id', tenantB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot update a tenant B official', async () => {
    const { data, error } = await clientAdminA
      .from('officials')
      .update({ name: 'Hijacked' })
      .eq('id', officialB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: unchanged } = await admin
      .from('officials')
      .select('name')
      .eq('id', officialB.id)
      .single()
    expect(unchanged?.name).toBe('Tenant B Official')
  })

  it('cannot delete a tenant B official', async () => {
    const { data, error } = await clientAdminA
      .from('officials')
      .delete()
      .eq('id', officialB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: stillThere } = await admin
      .from('officials')
      .select('id')
      .eq('id', officialB.id)
      .maybeSingle()
    expect(stillThere).not.toBeNull()
  })

  it('cannot create an official under tenant B', async () => {
    const { error } = await clientAdminA
      .from('officials')
      .insert({ tenant_id: tenantB.id, name: 'Forged official', phone: '+46709000002' })
    expect(error).not.toBeNull()
  })

  it('can read and manage its own tenant officials', async () => {
    const { data: created, error: insertError } = await clientAdminA
      .from('officials')
      .insert({ tenant_id: tenantA.id, name: 'Tenant A Official', phone: '+46709000003' })
      .select()
      .single()
    expect(insertError).toBeNull()
    expect(created?.tenant_id).toBe(tenantA.id)

    const { data: read, error: readError } = await clientAdminA
      .from('officials')
      .select('*')
      .eq('tenant_id', tenantA.id)
    expect(readError).toBeNull()
    expect(read).toHaveLength(1)
  })
})
