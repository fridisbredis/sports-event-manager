import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createOfficialLinkedToUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// assignments has tenant_admin_manage plus official_read_own_assignments
// (via officials.user_id = auth.uid()) — so this suite proves cross-tenant
// isolation for admins, and that one official cannot see another official's
// assignments within the same tenant.
describe('SEC-01: tenant isolation on assignments', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let assignmentB: { id: string }
  let officialAssignmentA: { id: string }
  let officialA1: { userId: string; phone: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>
  let clientOfficialA1: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Assignments')
    tenantB = await createTenant('Tenant B Assignments')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    officialA1 = await createUserWithRole(tenantA.id, 'official')
    const linkedOfficialA1 = await createOfficialLinkedToUser(tenantA.id, officialA1.userId, 'Official A1')
    clientOfficialA1 = await signInAsClient(officialA1.phone, '000000')

    const officialA2User = await createUserWithRole(tenantA.id, 'official')
    const linkedOfficialA2 = await createOfficialLinkedToUser(tenantA.id, officialA2User.userId, 'Official A2')

    const admin = serviceClient()

    const { data: assignmentA1, error: assignmentA1Error } = await admin
      .from('assignments')
      .insert({
        tenant_id: tenantA.id,
        official_id: linkedOfficialA1.id,
        slot_index: 0,
        status: 'available',
        timeslot_start: new Date(0).toISOString(),
        timeslot_end: new Date(3600_000).toISOString(),
      })
      .select()
      .single()
    if (assignmentA1Error) throw assignmentA1Error
    officialAssignmentA = assignmentA1

    const { error: assignmentA2Error } = await admin.from('assignments').insert({
      tenant_id: tenantA.id,
      official_id: linkedOfficialA2.id,
      slot_index: 0,
      status: 'available',
      timeslot_start: new Date(7200_000).toISOString(),
      timeslot_end: new Date(10800_000).toISOString(),
    })
    if (assignmentA2Error) throw assignmentA2Error

    const officialBUser = await createUserWithRole(tenantB.id, 'official')
    const linkedOfficialB = await createOfficialLinkedToUser(tenantB.id, officialBUser.userId, 'Official B')
    const { data: bRow, error: bError } = await admin
      .from('assignments')
      .insert({
        tenant_id: tenantB.id,
        official_id: linkedOfficialB.id,
        slot_index: 0,
        status: 'available',
        timeslot_start: new Date(0).toISOString(),
        timeslot_end: new Date(3600_000).toISOString(),
      })
      .select()
      .single()
    if (bError) throw bError
    assignmentB = bRow
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('admin cannot read tenant B assignments', async () => {
    const { data, error } = await clientAdminA
      .from('assignments')
      .select('*')
      .eq('tenant_id', tenantB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('admin cannot update or delete a tenant B assignment', async () => {
    const { data: updated } = await clientAdminA
      .from('assignments')
      .update({ status: 'blocked' })
      .eq('id', assignmentB.id)
      .select()
    expect(updated).toEqual([])

    const { data: deleted } = await clientAdminA
      .from('assignments')
      .delete()
      .eq('id', assignmentB.id)
      .select()
    expect(deleted).toEqual([])

    const admin = serviceClient()
    const { data: stillThere } = await admin
      .from('assignments')
      .select('id')
      .eq('id', assignmentB.id)
      .maybeSingle()
    expect(stillThere).not.toBeNull()
  })

  it('admin can manage its own tenant assignments', async () => {
    const { data, error } = await clientAdminA.from('assignments').select('*').eq('tenant_id', tenantA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
  })

  it('an official cannot read another official\'s assignment in the same tenant', async () => {
    const { data, error } = await clientOfficialA1
      .from('assignments')
      .select('*')
      .neq('id', officialAssignmentA.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('an official can read their own assignment', async () => {
    const { data, error } = await clientOfficialA1
      .from('assignments')
      .select('*')
      .eq('id', officialAssignmentA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})
