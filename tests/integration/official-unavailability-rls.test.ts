import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// Time off is gated entirely by RLS (migration 20261006113036). The ownership
// rule Peter settled on 2026-10-07 — whoever declared a period owns it, and
// neither role may touch the other's — is a data-layer control, so the unit
// tests around the two server actions can only prove they send the right
// query. Whether Postgres accepts or refuses it is testable only here.
//
// This matters more than most RLS tests: a refused DELETE removes zero rows
// and reports no error, so a UI that does not count rows cheerfully claims
// success for a period that is still there. Both actions count; these tests
// pin the policies those counts depend on.

const DAY = '2026-11-02'

describe('official_unavailability RLS ownership', () => {
  let tenantId: string
  let officialId: string
  let officialClient: SupabaseClient<Database>
  let adminClient: SupabaseClient<Database>
  let otherOfficialId: string
  let otherOfficialClient: SupabaseClient<Database>

  // Seeded fresh per test via resetPeriods(), since the deletes under test
  // would otherwise consume them.
  let ownPeriodId: string
  let adminPeriodId: string

  async function resetPeriods() {
    const admin = serviceClient()
    await admin.from('official_unavailability').delete().eq('tenant_id', tenantId)

    const { data: own, error: ownError } = await admin
      .from('official_unavailability')
      .insert({
        tenant_id: tenantId,
        official_id: officialId,
        starts_at: `${DAY}T09:00:00+00:00`,
        ends_at: `${DAY}T12:00:00+00:00`,
        created_by_role: 'official',
      })
      .select('id')
      .single()
    if (ownError) throw ownError
    ownPeriodId = own.id

    const { data: set, error: setError } = await admin
      .from('official_unavailability')
      .insert({
        tenant_id: tenantId,
        official_id: officialId,
        starts_at: `${DAY}T13:00:00+00:00`,
        ends_at: `${DAY}T17:00:00+00:00`,
        created_by_role: 'tenant_admin',
      })
      .select('id')
      .single()
    if (setError) throw setError
    adminPeriodId = set.id
  }

  beforeAll(async () => {
    const tenant = await createTenant('Unavailability RLS Tenant')
    tenantId = tenant.id

    const admin = serviceClient()

    // createUserWithRole already inserts the `officials` row for this role —
    // canViewOfficialSurfaces needs one — so these look theirs up rather than
    // creating a second, which would leave two roster rows per user and make
    // `is_own_official_row` ambiguous.
    const official = await createUserWithRole(tenantId, 'official')
    officialClient = await signInAsClient(official.phone, '000000')
    const { data: ownRow } = await admin
      .from('officials')
      .select('id')
      .eq('user_id', official.userId)
      .single()
    officialId = ownRow!.id

    const tenantAdmin = await createUserWithRole(tenantId, 'tenant_admin')
    adminClient = await signInAsClient(tenantAdmin.phone, '000000')

    const other = await createUserWithRole(tenantId, 'official')
    otherOfficialClient = await signInAsClient(other.phone, '000000')
    const { data: otherRow } = await admin
      .from('officials')
      .select('id')
      .eq('user_id', other.userId)
      .single()
    otherOfficialId = otherRow!.id
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  describe('an official', () => {
    it('withdraws a period they declared themselves', async () => {
      await resetPeriods()

      const { error, count } = await officialClient
        .from('official_unavailability')
        .delete({ count: 'exact' })
        .eq('id', ownPeriodId)

      expect(error).toBeNull()
      expect(count).toBe(1)
    })

    it('cannot withdraw time off the organisers recorded', async () => {
      // The failure this guards: RLS removes zero rows and returns no error,
      // so a screen that offers the button and does not count rows tells the
      // official it worked. It did not — the period returns on reload.
      await resetPeriods()

      const { error, count } = await officialClient
        .from('official_unavailability')
        .delete({ count: 'exact' })
        .eq('id', adminPeriodId)

      expect(error).toBeNull()
      expect(count).toBe(0)

      const admin = serviceClient()
      const { data } = await admin
        .from('official_unavailability')
        .select('id')
        .eq('id', adminPeriodId)
      expect(data).toHaveLength(1)
    })

    it('cannot declare a period posing as the organisers', async () => {
      const { error } = await officialClient.from('official_unavailability').insert({
        tenant_id: tenantId,
        official_id: officialId,
        starts_at: `${DAY}T20:00:00+00:00`,
        ends_at: `${DAY}T21:00:00+00:00`,
        created_by_role: 'tenant_admin',
      })

      expect(error).not.toBeNull()
    })

    it('sees their own periods, including ones the organisers recorded', async () => {
      // Being marked off is something an official must be able to see, even
      // though they cannot remove it.
      await resetPeriods()

      const { data, error } = await officialClient
        .from('official_unavailability')
        .select('id, created_by_role')
        .eq('official_id', officialId)

      expect(error).toBeNull()
      expect(data?.map((r) => r.created_by_role).sort()).toEqual(['official', 'tenant_admin'])
    })

    it("cannot see a colleague's periods at all", async () => {
      // Narrower than `assignments`, where officials DO see who shares their
      // shift: a name on a shared shift is roster information, a reason for
      // being away is not.
      await resetPeriods()

      const { data, error } = await otherOfficialClient
        .from('official_unavailability')
        .select('id')
        .eq('official_id', officialId)

      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })

  describe('an admin', () => {
    it('withdraws a period they recorded', async () => {
      await resetPeriods()

      const { error, count } = await adminClient
        .from('official_unavailability')
        .delete({ count: 'exact' })
        .eq('id', adminPeriodId)

      expect(error).toBeNull()
      expect(count).toBe(1)
    })

    it("cannot withdraw an official's own declaration", async () => {
      // The mirror of the official case: that statement belongs to the person
      // who made it, and silently editing it would leave them believing
      // something the schedule no longer reflects.
      await resetPeriods()

      const { error, count } = await adminClient
        .from('official_unavailability')
        .delete({ count: 'exact' })
        .eq('id', ownPeriodId)

      expect(error).toBeNull()
      expect(count).toBe(0)
    })

    it("cannot edit an official's own declaration", async () => {
      await resetPeriods()

      const { error, count } = await adminClient
        .from('official_unavailability')
        .update({ reason: 'rewritten by admin' }, { count: 'exact' })
        .eq('id', ownPeriodId)

      expect(error).toBeNull()
      expect(count).toBe(0)
    })

    it('records time off for any official in the tenant', async () => {
      const { error } = await adminClient.from('official_unavailability').insert({
        tenant_id: tenantId,
        official_id: otherOfficialId,
        starts_at: `${DAY}T18:00:00+00:00`,
        ends_at: `${DAY}T19:00:00+00:00`,
        created_by_role: 'tenant_admin',
      })

      expect(error).toBeNull()
    })

    it('sees every period in the tenant', async () => {
      await resetPeriods()

      const { data, error } = await adminClient
        .from('official_unavailability')
        .select('id')
        .eq('tenant_id', tenantId)

      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThanOrEqual(2)
    })
  })
})
