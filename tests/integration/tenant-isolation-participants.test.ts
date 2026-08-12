import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  createTenant,
  createUserWithRole,
  createParticipantLinkedToUser,
  signInAsClient,
  serviceClient,
  cleanupTenant,
} from './helpers'

// participants has no tenant_member_read policy (see migration 0002) — only
// tenant_admin_manage and participant_read_own (user_id = auth.uid()). So
// this suite proves two boundaries: cross-tenant admin access, and same-tenant
// read access to another person's participant row.
describe('SEC-01: tenant isolation on participants', () => {
  let tenantA: { id: string }
  let tenantB: { id: string }
  let participantB: { id: string }
  let ownParticipantA: { id: string; userId: string }
  let clientAdminA: Awaited<ReturnType<typeof signInAsClient>>
  let clientParticipantA: Awaited<ReturnType<typeof signInAsClient>>

  beforeAll(async () => {
    tenantA = await createTenant('Tenant A Participants')
    tenantB = await createTenant('Tenant B Participants')

    const adminA = await createUserWithRole(tenantA.id, 'tenant_admin')
    clientAdminA = await signInAsClient(adminA.phone, '000000')

    const participantUserA = await createUserWithRole(tenantA.id, 'participant')
    const linkedA = await createParticipantLinkedToUser(
      tenantA.id,
      participantUserA.userId,
      'Own Participant A',
    )
    ownParticipantA = { id: linkedA.id, userId: participantUserA.userId }
    clientParticipantA = await signInAsClient(participantUserA.phone, '000000')

    const admin = serviceClient()
    const { data, error } = await admin
      .from('participants')
      .insert({ tenant_id: tenantB.id, name: 'Tenant B Participant', phone: '+46709100001' })
      .select()
      .single()
    if (error) throw error
    participantB = data
  })

  afterAll(async () => {
    await cleanupTenant(tenantA.id)
    await cleanupTenant(tenantB.id)
  })

  it('admin cannot read tenant B participants', async () => {
    const { data, error } = await clientAdminA
      .from('participants')
      .select('*')
      .eq('tenant_id', tenantB.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('admin cannot update or delete a tenant B participant', async () => {
    const { data: updated } = await clientAdminA
      .from('participants')
      .update({ name: 'Hijacked' })
      .eq('id', participantB.id)
      .select()
    expect(updated).toEqual([])

    const { data: deleted } = await clientAdminA
      .from('participants')
      .delete()
      .eq('id', participantB.id)
      .select()
    expect(deleted).toEqual([])

    const admin = serviceClient()
    const { data: stillThere } = await admin
      .from('participants')
      .select('name')
      .eq('id', participantB.id)
      .single()
    expect(stillThere?.name).toBe('Tenant B Participant')
  })

  it('admin cannot create a participant under tenant B', async () => {
    const { error } = await clientAdminA
      .from('participants')
      .insert({ tenant_id: tenantB.id, name: 'Forged participant', phone: '+46709100002' })
    expect(error).not.toBeNull()
  })

  it('admin can manage its own tenant participants', async () => {
    const { data: read, error: readError } = await clientAdminA
      .from('participants')
      .select('*')
      .eq('tenant_id', tenantA.id)
    expect(readError).toBeNull()
    expect(read).toHaveLength(1)
    expect(read?.[0].id).toBe(ownParticipantA.id)
  })

  it('a participant cannot read another participant in the same tenant', async () => {
    const { data, error } = await clientParticipantA
      .from('participants')
      .select('*')
      .neq('id', ownParticipantA.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('a participant can read their own participant row', async () => {
    const { data, error } = await clientParticipantA
      .from('participants')
      .select('*')
      .eq('id', ownParticipantA.id)
    expect(error).toBeNull()
    expect(data).toHaveLength(1)
  })
})
