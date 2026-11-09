import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  createSystemAdmin,
  deleteAuthUser,
  signInAsClient,
} from './helpers'

// N37: user_ice_contacts (migration 20261109141949) holds a third person's
// phone number. The card's "done when" is that an official cannot read another
// user's ICE contact through the API — so every read here goes through a
// signed-in session straight at PostgREST, where only RLS stands in the way.
//
// Readers: the user themself, a tenant_admin of a tenant the user has a role
// in, and a system_admin. Nobody else, and admins never write.

describe('user_ice_contacts RLS (N37)', () => {
  let tenantX: string
  let tenantY: string

  let officialA: string // tenant X, has an ICE contact
  let officialB: string // tenant X, colleague of A
  let adminX: string
  let systemAdmin: string

  let clientA: SupabaseClient<Database>
  let clientB: SupabaseClient<Database>
  let clientAdminX: SupabaseClient<Database>
  let clientAdminY: SupabaseClient<Database>
  let clientSystemAdmin: SupabaseClient<Database>

  const ICE_A = { phone: '46700000001', name: 'Göran Berg', relation: 'Spouse/partner' }

  async function readIce(client: SupabaseClient<Database>, userId: string) {
    const { data, error } = await client
      .from('user_ice_contacts')
      .select('phone, name, relation')
      .eq('user_id', userId)
    expect(error).toBeNull()
    return data
  }

  beforeAll(async () => {
    tenantX = (await createTenant('ICE Tenant X')).id
    tenantY = (await createTenant('ICE Tenant Y')).id

    const a = await createUserWithRole(tenantX, 'official')
    const b = await createUserWithRole(tenantX, 'official')
    const ax = await createUserWithRole(tenantX, 'tenant_admin')
    const ay = await createUserWithRole(tenantY, 'tenant_admin')
    const sa = await createSystemAdmin()

    officialA = a.userId
    officialB = b.userId
    adminX = ax.userId
    systemAdmin = sa.userId

    clientA = await signInAsClient(a.phone, '000000')
    clientB = await signInAsClient(b.phone, '000000')
    clientAdminX = await signInAsClient(ax.phone, '000000')
    clientAdminY = await signInAsClient(ay.phone, '000000')
    clientSystemAdmin = await signInAsClient(sa.phone, '000000')
  })

  afterAll(async () => {
    // on delete cascade removes the ICE rows with the auth users.
    await cleanupTenant(tenantX)
    await cleanupTenant(tenantY)
    await deleteAuthUser(systemAdmin)
  })

  it('lets a user save and read their own ICE contact', async () => {
    const { error } = await clientA
      .from('user_ice_contacts')
      .upsert({ user_id: officialA, ...ICE_A }, { onConflict: 'user_id' })
    expect(error).toBeNull()

    expect(await readIce(clientA, officialA)).toEqual([ICE_A])
  })

  it('lets a user update their own ICE contact (upsert on existing row)', async () => {
    const { error } = await clientA
      .from('user_ice_contacts')
      .upsert({ user_id: officialA, ...ICE_A, relation: 'Partner' }, { onConflict: 'user_id' })
    expect(error).toBeNull()
    expect(await readIce(clientA, officialA)).toEqual([{ ...ICE_A, relation: 'Partner' }])

    await clientA
      .from('user_ice_contacts')
      .update({ relation: ICE_A.relation })
      .eq('user_id', officialA)
  })

  it("hides an official's ICE contact from a colleague in the same tenant", async () => {
    expect(await readIce(clientB, officialA)).toEqual([])

    // Unfiltered, too: B sees nothing but (at most) their own row.
    const { data } = await clientB.from('user_ice_contacts').select('user_id')
    expect(data?.every((r) => r.user_id === officialB)).toBe(true)
  })

  it('lets a tenant admin read the ICE contact of a user in their tenant', async () => {
    expect(await readIce(clientAdminX, officialA)).toEqual([ICE_A])
  })

  it("hides the ICE contact from an admin of a tenant the user isn't in", async () => {
    expect(await readIce(clientAdminY, officialA)).toEqual([])
  })

  it('lets a system admin read any ICE contact', async () => {
    expect(await readIce(clientSystemAdmin, officialA)).toEqual([ICE_A])
  })

  // Direction guard. can_read_ice_contact() must ask "is the CALLER a
  // tenant_admin sharing a tenant with the target", not "is the TARGET a
  // tenant_admin". Written backwards, an admin's ICE contact would be readable
  // by every official in the tenant. This is the case that catches it.
  it("hides an admin's ICE contact from an official in the same tenant", async () => {
    const { error } = await clientAdminX
      .from('user_ice_contacts')
      .upsert({ user_id: adminX, phone: '46700000002' }, { onConflict: 'user_id' })
    expect(error).toBeNull()

    expect(await readIce(clientB, adminX)).toEqual([])
  })

  it("refuses an ICE contact written in someone else's name", async () => {
    const { error } = await clientB
      .from('user_ice_contacts')
      .insert({ user_id: officialA, phone: '46700000099' })
    expect(error?.code).toBe('42501')
  })

  it("does not let an admin change a user's ICE contact", async () => {
    await clientAdminX
      .from('user_ice_contacts')
      .update({ phone: '46700000099' })
      .eq('user_id', officialA)
    await clientAdminX.from('user_ice_contacts').delete().eq('user_id', officialA)

    const { data } = await serviceClient()
      .from('user_ice_contacts')
      .select('phone, name, relation')
      .eq('user_id', officialA)
      .single()
    expect(data).toEqual(ICE_A)
  })

  it('does not let a colleague delete the ICE contact', async () => {
    await clientB.from('user_ice_contacts').delete().eq('user_id', officialA)

    const { count } = await serviceClient()
      .from('user_ice_contacts')
      .select('user_id', { count: 'exact', head: true })
      .eq('user_id', officialA)
    expect(count).toBe(1)
  })

  it('rejects overlong values (CHECK constraints)', async () => {
    const { error } = await clientA
      .from('user_ice_contacts')
      .update({ relation: 'x'.repeat(101) })
      .eq('user_id', officialA)
    expect(error?.code).toBe('23514')
  })
})
