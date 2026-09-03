import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

describe('SEC-01: tenant isolation on events', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let eventB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A')
    tenantB = await createTenant('Tenant B')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const admin = serviceClient()
    const { data, error } = await admin
      .from('events')
      .insert({ tenant_id: tenantB.id, name: 'Tenant B Championship', event_type: 'race' })
      .select()
      .single()
    if (error) throw error
    eventB = data
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('cannot read tenant B events', async () => {
    const { data, error } = await clientAdminA
      .from('events')
      .select('*')
      .eq('tenant_id', tenantB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot update a tenant B event', async () => {
    const { data, error } = await clientAdminA
      .from('events')
      .update({ name: 'Hijacked' })
      .eq('id', eventB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: unchanged } = await admin
      .from('events')
      .select('name')
      .eq('id', eventB.id)
      .single()
    expect(unchanged?.name).toBe('Tenant B Championship')
  })

  it('cannot delete a tenant B event', async () => {
    const { data, error } = await clientAdminA.from('events').delete().eq('id', eventB.id).select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: stillThere } = await admin
      .from('events')
      .select('id')
      .eq('id', eventB.id)
      .maybeSingle()
    expect(stillThere).not.toBeNull()
  })

  it('cannot create an event under tenant B', async () => {
    const { error } = await clientAdminA
      .from('events')
      .insert({ tenant_id: tenantB.id, name: 'Forged event', event_type: 'race' })
    expect(error).not.toBeNull()
  })

  it('can read and manage its own tenant events', async () => {
    const { data: created, error: insertError } = await clientAdminA
      .from('events')
      .insert({ tenant_id: tenantA.id, name: 'Tenant A 10k', event_type: 'race' })
      .select()
      .single()
    expect(insertError).toBeNull()
    expect(created?.tenant_id).toBe(tenantA.id)

    const { data: read, error: readError } = await clientAdminA
      .from('events')
      .select('*')
      .eq('tenant_id', tenantA.id)
    expect(readError).toBeNull()
    expect(read).toHaveLength(1)
  })
})
