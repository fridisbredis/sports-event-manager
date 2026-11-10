import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolveTenantForParticipant } from '@/lib/auth/tenant'
import {
  serviceClient,
  createTenant,
  cleanupTenant,
  createUserWithRole,
  createUserWithoutRole,
  createParticipantLinkedToUser,
  deleteAuthUser,
} from './helpers'

// N43: who may open the participant surfaces. Against real Postgres because
// the rule is about rows as the app actually writes them — in particular an
// official who claims keeps their 'official' user_roles row, so a guard keyed
// on the role would lock them out, and only real rows show that.
describe('N43: resolveTenantForParticipant (real Postgres)', () => {
  let tenant: { id: string; slug: string }
  let eventA: string
  let eventB: string
  const looseUsers: string[] = []

  beforeAll(async () => {
    tenant = await createTenant('Participant Access', 'premium')
    const { data, error } = await serviceClient()
      .from('events')
      .insert([
        { tenant_id: tenant.id, name: 'A', event_type: 'race' },
        { tenant_id: tenant.id, name: 'B', event_type: 'race' },
      ])
      .select('id, name')
    if (error) throw error
    eventA = data.find((e) => e.name === 'A')!.id
    eventB = data.find((e) => e.name === 'B')!.id
  })

  afterAll(async () => {
    await cleanupTenant(tenant.id)
    for (const id of looseUsers) await deleteAuthUser(id)
  })

  async function participantUser() {
    const user = await createUserWithoutRole()
    looseUsers.push(user.userId)
    return user
  }

  it('lets in a linked participant, with every event they are entered in', async () => {
    const user = await participantUser()
    const inA = await createParticipantLinkedToUser(tenant.id, eventA, user.userId, 'Runner')
    const inB = await createParticipantLinkedToUser(tenant.id, eventB, user.userId, 'Runner')

    const resolved = await resolveTenantForParticipant(tenant.slug, user.userId)

    expect(resolved?.id).toBe(tenant.id)
    expect(resolved?.entries).toEqual([
      { participantId: inA.id, eventId: eventA },
      { participantId: inB.id, eventId: eventB },
    ])
  })

  it('lets in an official who has claimed a record, though their role stays official', async () => {
    const official = await createUserWithRole(tenant.id, 'official')
    const record = await createParticipantLinkedToUser(tenant.id, eventA, official.userId, 'Both')

    const { data: role } = await serviceClient()
      .from('user_roles')
      .select('role')
      .eq('user_id', official.userId)
      .eq('tenant_id', tenant.id)
      .single()
    expect(role?.role).toBe('official')

    const resolved = await resolveTenantForParticipant(tenant.slug, official.userId)
    expect(resolved?.entries).toEqual([{ participantId: record.id, eventId: eventA }])
  })

  it('denies an official with no participant record', async () => {
    const official = await createUserWithRole(tenant.id, 'official')
    expect(await resolveTenantForParticipant(tenant.slug, official.userId)).toBeNull()
  })

  it('denies a tenant admin with no participant record', async () => {
    const admin = await createUserWithRole(tenant.id, 'tenant_admin')
    expect(await resolveTenantForParticipant(tenant.slug, admin.userId)).toBeNull()
  })

  it('denies a participant once unlinked', async () => {
    const user = await participantUser()
    const record = await createParticipantLinkedToUser(tenant.id, eventA, user.userId, 'Gone')
    const { error } = await serviceClient()
      .from('participants')
      .update({ user_id: null })
      .eq('id', record.id)
    if (error) throw error

    expect(await resolveTenantForParticipant(tenant.slug, user.userId)).toBeNull()
  })

  it('denies a participant of another tenant', async () => {
    const other = await createTenant('Participant Access Other', 'premium')
    try {
      const user = await participantUser()
      await createParticipantLinkedToUser(tenant.id, eventA, user.userId, 'Elsewhere')
      expect(await resolveTenantForParticipant(other.slug, user.userId)).toBeNull()
    } finally {
      await cleanupTenant(other.id)
    }
  })

  it('denies everyone while the tenant is suspended', async () => {
    const suspended = await createTenant('Participant Access Suspended', 'premium')
    try {
      const { data: event } = await serviceClient()
        .from('events')
        .insert({ tenant_id: suspended.id, name: 'S', event_type: 'race' })
        .select('id')
        .single()
      const user = await participantUser()
      await createParticipantLinkedToUser(suspended.id, event!.id, user.userId, 'Paused')
      await serviceClient().from('tenants').update({ is_active: false }).eq('id', suspended.id)

      expect(await resolveTenantForParticipant(suspended.slug, user.userId)).toBeNull()
    } finally {
      await cleanupTenant(suspended.id)
    }
  })
})
