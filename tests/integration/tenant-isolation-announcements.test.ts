import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

describe('SEC-01: tenant isolation on announcements', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let announcementB: { id: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Announcements')
    tenantB = await createTenant('Tenant B Announcements')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const admin = serviceClient()
    const { data, error } = await admin
      .from('announcements')
      .insert({
        tenant_id: tenantB.id,
        channel: 'officials',
        body: 'Tenant B announcement',
        published_at: new Date(0).toISOString(),
      })
      .select()
      .single()
    if (error) throw error
    announcementB = data
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('cannot read tenant B announcements', async () => {
    const { data, error } = await clientAdminA
      .from('announcements')
      .select('*')
      .eq('tenant_id', tenantB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('cannot update a tenant B announcement', async () => {
    const { data, error } = await clientAdminA
      .from('announcements')
      .update({ body: 'Hijacked' })
      .eq('id', announcementB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: unchanged } = await admin
      .from('announcements')
      .select('body')
      .eq('id', announcementB.id)
      .single()
    expect(unchanged?.body).toBe('Tenant B announcement')
  })

  it('cannot delete a tenant B announcement', async () => {
    const { data, error } = await clientAdminA
      .from('announcements')
      .delete()
      .eq('id', announcementB.id)
      .select()
    expect(error).toBeNull()
    expect(data).toEqual([])

    const admin = serviceClient()
    const { data: stillThere } = await admin
      .from('announcements')
      .select('id')
      .eq('id', announcementB.id)
      .maybeSingle()
    expect(stillThere).not.toBeNull()
  })

  it('cannot create an announcement under tenant B', async () => {
    const { error } = await clientAdminA.from('announcements').insert({
      tenant_id: tenantB.id,
      channel: 'officials',
      body: 'Forged announcement',
      published_at: new Date(0).toISOString(),
    })
    expect(error).not.toBeNull()
  })

  it('can read and manage its own tenant announcements', async () => {
    const { data: created, error: insertError } = await clientAdminA
      .from('announcements')
      .insert({
        tenant_id: tenantA.id,
        channel: 'officials',
        body: 'Tenant A announcement',
        published_at: new Date(0).toISOString(),
      })
      .select()
      .single()
    expect(insertError).toBeNull()
    expect(created?.tenant_id).toBe(tenantA.id)

    const { data: read, error: readError } = await clientAdminA
      .from('announcements')
      .select('*')
      .eq('tenant_id', tenantA.id)
    expect(readError).toBeNull()
    expect(read).toHaveLength(1)
  })
})
