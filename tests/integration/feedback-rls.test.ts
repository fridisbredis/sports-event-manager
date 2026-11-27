import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '../../src/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  createSystemAdmin,
  deleteAuthUser,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// N71 (migration 20261127094110): who can write, read and triage feedback,
// through real PostgREST and Storage with real sessions — the layer the unit
// tests mock away.
//
// Also the contract test for update_feedback_status's return shape: the
// server action reads { id, status } out of it, and gen types only sees Json.

const BUCKET = 'feedback-images'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

type Client = SupabaseClient<Database>

describe('feedback: RLS, grants, status RPC and image storage', () => {
  let tenantId: string
  let officialA: { userId: string; client: Client }
  let officialB: { userId: string; client: Client }
  let tenantAdmin: { userId: string; client: Client }
  let systemAdmin: { userId: string; client: Client }
  const uploaded: string[] = []

  function row(userId: string, overrides: Record<string, unknown> = {}) {
    return {
      id: randomUUID(),
      tenant_id: tenantId,
      user_id: userId,
      user_role: 'official',
      type: 'bug',
      title: 'Integration test',
      body: 'Written by the integration suite.',
      page_path: '/test',
      ...overrides,
    }
  }

  beforeAll(async () => {
    const tenant = await createTenant('Feedback RLS')
    tenantId = tenant.id
    // One at a time: the test-phone pool and GoTrue both misbehave when
    // users are created in parallel.
    const a = await createUserWithRole(tenantId, 'official')
    const b = await createUserWithRole(tenantId, 'official')
    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    const sys = await createSystemAdmin()
    officialA = { userId: a.userId, client: await signInAsClient(a.phone, '000000') }
    officialB = { userId: b.userId, client: await signInAsClient(b.phone, '000000') }
    tenantAdmin = { userId: admin.userId, client: await signInAsClient(admin.phone, '000000') }
    systemAdmin = { userId: sys.userId, client: await signInAsClient(sys.phone, '000000') }
  })

  afterAll(async () => {
    const service = serviceClient()
    if (uploaded.length) await service.storage.from(BUCKET).remove(uploaded)
    // feedback rows go with the tenant (on delete cascade).
    await cleanupTenant(tenantId)
    await deleteAuthUser(systemAdmin.userId)
  })

  it('lets a member send feedback as a role they hold, and only that', async () => {
    const ok = await officialA.client.from('feedback').insert(row(officialA.userId))
    expect(ok.error).toBeNull()

    const wrongRole = await officialA.client
      .from('feedback')
      .insert(row(officialA.userId, { user_role: 'tenant_admin' }))
    expect(wrongRole.error?.code).toBe('42501')

    const asSomeoneElse = await officialA.client.from('feedback').insert(row(officialB.userId))
    expect(asSomeoneElse.error?.code).toBe('42501')
  })

  // The column-level insert grant: status keeps its default. Without the
  // revoke in the migration, Supabase's default privileges let this through.
  it('refuses a sender setting their own status', async () => {
    const { error } = await officialA.client
      .from('feedback')
      .insert({ ...row(officialA.userId), status: 'done' })
    expect(error?.code).toBe('42501')
  })

  it('shows feedback to its sender and system admins only', async () => {
    const own = await officialA.client.from('feedback').select('id').eq('tenant_id', tenantId)
    expect(own.data?.length).toBeGreaterThan(0)

    const colleague = await officialB.client.from('feedback').select('id').eq('tenant_id', tenantId)
    expect(colleague.data).toEqual([])

    const admin = await tenantAdmin.client.from('feedback').select('id').eq('tenant_id', tenantId)
    expect(admin.data).toEqual([])

    const sys = await systemAdmin.client.from('feedback').select('id').eq('tenant_id', tenantId)
    expect(sys.data?.length).toBe(own.data?.length)
  })

  it('refuses the status RPC to anyone but a system admin', async () => {
    const target = row(officialA.userId)
    await officialA.client.from('feedback').insert(target)

    for (const client of [officialA.client, tenantAdmin.client]) {
      const { error } = await client.rpc('update_feedback_status', {
        p_feedback_id: target.id,
        p_status: 'done',
      })
      expect(error?.code).toBe('42501')
    }
  })

  it('changes exactly one row and returns { id, status }', async () => {
    const target = row(officialA.userId)
    const other = row(officialA.userId)
    await officialA.client.from('feedback').insert([target, other])

    const { data, error } = await systemAdmin.client.rpc('update_feedback_status', {
      p_feedback_id: target.id,
      p_status: 'in_progress',
    })
    expect(error).toBeNull()
    expect(data).toEqual({ id: target.id, status: 'in_progress' })

    const { data: rows } = await officialA.client
      .from('feedback')
      .select('id, status')
      .in('id', [target.id, other.id])
    const byId = Object.fromEntries((rows ?? []).map((r) => [r.id, r.status]))
    expect(byId[target.id]).toBe('in_progress')
    expect(byId[other.id]).toBe('new')
  })

  it('rejects an unknown status', async () => {
    const target = row(officialA.userId)
    await officialA.client.from('feedback').insert(target)
    const { error } = await systemAdmin.client.rpc('update_feedback_status', {
      p_feedback_id: target.id,
      p_status: 'archived',
    })
    expect(error?.code).toBe('22023')
  })

  it('keeps images in their uploader’s folder, readable by them and system admins only', async () => {
    const feedbackId = randomUUID()
    const own = `${tenantId}/${officialA.userId}/${feedbackId}/image.png`
    const upload = await officialA.client.storage
      .from(BUCKET)
      .upload(own, PNG, { contentType: 'image/png' })
    expect(upload.error).toBeNull()
    uploaded.push(own)

    const intoOther = `${tenantId}/${officialB.userId}/${randomUUID()}/image.png`
    const refused = await officialA.client.storage
      .from(BUCKET)
      .upload(intoOther, PNG, { contentType: 'image/png' })
    expect(refused.error).not.toBeNull()

    const inserted = await officialA.client
      .from('feedback')
      .insert(row(officialA.userId, { id: feedbackId, image_path: own }))
    expect(inserted.error).toBeNull()

    const sysUrl = await systemAdmin.client.storage.from(BUCKET).createSignedUrl(own, 60)
    expect(sysUrl.error).toBeNull()

    const colleagueRead = await officialB.client.storage.from(BUCKET).download(own)
    expect(colleagueRead.error).not.toBeNull()

    // Once a row points at it, not even the uploader can delete it.
    await officialA.client.storage.from(BUCKET).remove([own])
    const stillThere = await systemAdmin.client.storage.from(BUCKET).download(own)
    expect(stillThere.error).toBeNull()
  })

  it('refuses a row pointing at someone else’s image', async () => {
    const feedbackId = randomUUID()
    const { error } = await officialA.client.from('feedback').insert(
      row(officialA.userId, {
        id: feedbackId,
        image_path: `${tenantId}/${officialB.userId}/${feedbackId}/image.png`,
      })
    )
    expect(error?.code).toBe('42501')
  })
})
