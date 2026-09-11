import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  createOfficialLinkedToUser,
  cleanupTenant,
} from './helpers'

// F-MNT-20: Peter's decision of 2026-06-24 says a tenant admin is always
// schedulable and appears on the roster automatically, implicitly Confirmed.
// The app never implemented it — a tenant_admin has a user_roles row but no
// officials row — so OFF-01 omitted them, /{slug}/account 404'd and SCHED-01's
// confirmed-only pool excluded them.
//
// ensure_admin_roster_row (migration 20260911130436) closes that gap. These
// tests cover the parts that are easy to get wrong rather than the happy path
// alone: officials has NO unique constraint on (tenant_id, user_id), only a
// partial unique index on (tenant_id, phone) where invite_status <> 'removed'
// (migration 0020). So idempotency and phone-collision handling are carried
// entirely by the function body, not by the schema, and a regression there
// would silently produce duplicate roster rows or a 23505.
describe('ensure_admin_roster_row', () => {
  let tenantId: string

  beforeAll(async () => {
    const tenant = await createTenant('Admin Roster RPC')
    tenantId = tenant.id
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  async function rosterRowsFor(userId: string) {
    const { data, error } = await serviceClient()
      .from('officials')
      .select('id, name, phone, invite_status, user_id')
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
    if (error) throw error
    return data ?? []
  }

  it('creates a confirmed roster row for an admin who has none, and is idempotent', async () => {
    const admin = await createUserWithRole(tenantId, 'tenant_admin')

    // Reproduces the bug's starting state: role but no roster row.
    expect(await rosterRowsFor(admin.userId)).toHaveLength(0)

    const { data: first, error: firstError } = await serviceClient().rpc(
      'ensure_admin_roster_row',
      { p_tenant_id: tenantId, p_user_id: admin.userId }
    )
    expect(firstError).toBeNull()
    const firstResult = first as unknown as { official_id: string; created: boolean }
    expect(firstResult.created).toBe(true)

    const rows = await rosterRowsFor(admin.userId)
    expect(rows).toHaveLength(1)
    // Implicitly Confirmed — the whole point, since SCHED-01's pool and the
    // ACCT-01 lookup both filter on invite_status = 'confirmed'.
    expect(rows[0].invite_status).toBe('confirmed')
    expect(rows[0].id).toBe(firstResult.official_id)

    // Second and third calls must not add a row. With no unique constraint on
    // (tenant_id, user_id) the database would happily accept duplicates, so
    // this asserts the function's own guard.
    for (const _ of [1, 2]) {
      const { data: again, error: againError } = await serviceClient().rpc(
        'ensure_admin_roster_row',
        { p_tenant_id: tenantId, p_user_id: admin.userId }
      )
      expect(againError).toBeNull()
      const againResult = again as unknown as { official_id: string; created: boolean }
      expect(againResult.created).toBe(false)
      expect(againResult.official_id).toBe(firstResult.official_id)
    }

    expect(await rosterRowsFor(admin.userId)).toHaveLength(1)
  })

  it('reuses an existing confirmed row instead of writing a second one', async () => {
    // This is the shape of two of the three real prod admins (Peter Thörn and
    // Lotta Thörn, 2026-07-07): invited as ordinary officials first, promoted
    // to admin later. Their rows must be left exactly as they are.
    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    const existing = await createOfficialLinkedToUser(tenantId, admin.userId, 'Already On Roster')

    const { data, error } = await serviceClient().rpc('ensure_admin_roster_row', {
      p_tenant_id: tenantId,
      p_user_id: admin.userId,
    })
    expect(error).toBeNull()
    const result = data as unknown as { official_id: string; created: boolean }
    expect(result.created).toBe(false)
    expect(result.official_id).toBe(existing.id)

    const rows = await rosterRowsFor(admin.userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Already On Roster')
  })

  it('claims a phone-matched roster row that is not yet linked to the user', async () => {
    // An admin added to the roster by name and number before they ever signed
    // in: the row carries their phone but user_id is null. Inserting a second
    // row would violate officials_tenant_phone_active_uniq (0020), so the
    // function must adopt this one instead.
    const admin = await createUserWithRole(tenantId, 'tenant_admin')
    const serviceAdmin = serviceClient()

    const { data: authUser, error: authError } = await serviceAdmin.auth.admin.getUserById(
      admin.userId
    )
    if (authError) throw authError
    const storedPhone = (authUser.user.phone ?? '').replace(/^\+/, '')
    expect(storedPhone).not.toBe('')

    const { data: unlinked, error: unlinkedError } = await serviceAdmin
      .from('officials')
      .insert({
        tenant_id: tenantId,
        user_id: null,
        name: 'Added By Phone',
        phone: storedPhone,
        invite_status: 'invited',
      })
      .select('id')
      .single()
    if (unlinkedError) throw unlinkedError

    const { data, error } = await serviceAdmin.rpc('ensure_admin_roster_row', {
      p_tenant_id: tenantId,
      p_user_id: admin.userId,
    })
    expect(error).toBeNull()
    const result = data as unknown as { official_id: string; created: boolean }
    // Adopted, not inserted — otherwise this call would have failed with 23505.
    expect(result.created).toBe(false)
    expect(result.official_id).toBe(unlinked.id)

    const rows = await rosterRowsFor(admin.userId)
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(unlinked.id)
    // Adopting the row also confirms it, so the admin is schedulable.
    expect(rows[0].invite_status).toBe('confirmed')
  })

  it('refuses to write a roster row for a user who is not a tenant_admin', async () => {
    // The security boundary. SECURITY DEFINER means RLS is not gating this, so
    // the role check inside the body is the only thing stopping a caller from
    // conjuring a confirmed roster row for an arbitrary user.
    const official = await createUserWithRole(tenantId, 'official')

    const { error } = await serviceClient().rpc('ensure_admin_roster_row', {
      p_tenant_id: tenantId,
      p_user_id: official.userId,
    })

    expect(error).not.toBeNull()
    expect(error?.code).toBe('42501')
  })
})
