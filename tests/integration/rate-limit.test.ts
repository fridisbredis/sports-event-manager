import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  serviceClient,
  createTenant,
  createUserWithRole,
  signInAsClient,
  cleanupTenant,
} from './helpers'

// F-SEC-08: exercises the real check_rate_limit/release_rate_limit RPCs
// (migration 0026) against real Postgres. Their whole point — atomicity via
// INSERT ... ON CONFLICT, and window-reset-not-decrement semantics — cannot
// be verified through a mock, only against a real database. Short
// p_duration_seconds values (1-2s) keep the window-reset cases fast. Every
// key includes a Date.now()/random suffix so tests never collide with each
// other or leave residue for the next run; the rows created here are
// deleted in afterAll.

function uniqueKey(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
}

type CheckResult = Database['public']['Functions']['check_rate_limit']['Returns'][number]

const createdKeys: string[] = []

function trackedKey(prefix: string) {
  const key = uniqueKey(prefix)
  createdKeys.push(key)
  return key
}

async function check(
  admin: ReturnType<typeof serviceClient>,
  key: string,
  limit: number,
  durationSeconds: number
): Promise<CheckResult> {
  const { data, error } = await admin.rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_duration_seconds: durationSeconds,
  })
  if (error) throw error
  return data[0]
}

async function release(admin: ReturnType<typeof serviceClient>, key: string) {
  const { error } = await admin.rpc('release_rate_limit', { p_key: key })
  if (error) throw error
}

describe('F-SEC-08: check_rate_limit / release_rate_limit RPCs', () => {
  afterAll(async () => {
    const admin = serviceClient()
    if (createdKeys.length > 0) {
      await admin.from('rate_limit_hits').delete().in('key', createdKeys)
    }
  })

  it('allows every call under the limit', async () => {
    const admin = serviceClient()
    const key = trackedKey('rl-under')

    for (let i = 0; i < 3; i++) {
      const result = await check(admin, key, 3, 2)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks the call that pushes past the limit, with a positive retry_after_ms', async () => {
    const admin = serviceClient()
    const key = trackedKey('rl-over')

    for (let i = 0; i < 3; i++) {
      const result = await check(admin, key, 3, 2)
      expect(result.allowed).toBe(true)
    }

    const blocked = await check(admin, key, 3, 2)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retry_after_ms).toBeGreaterThan(0)
  })

  it('resets the window (rather than merely decrementing) once p_duration_seconds elapses', async () => {
    const admin = serviceClient()
    const key = trackedKey('rl-reset')

    for (let i = 0; i < 2; i++) {
      const result = await check(admin, key, 2, 1)
      expect(result.allowed).toBe(true)
    }
    const blocked = await check(admin, key, 2, 1)
    expect(blocked.allowed).toBe(false)

    await admin
      .from('rate_limit_hits')
      .update({ expire: new Date(Date.now() - 1000).toISOString() })
      .eq('key', key)

    const fresh = await check(admin, key, 2, 1)
    expect(fresh.allowed).toBe(true)
  })

  it('release_rate_limit frees a point so a subsequent check succeeds where it would otherwise be blocked', async () => {
    const admin = serviceClient()
    const key = trackedKey('rl-release')

    await check(admin, key, 1, 5)
    const blocked = await check(admin, key, 1, 5)
    expect(blocked.allowed).toBe(false)

    await release(admin, key)

    const afterRelease = await check(admin, key, 1, 5)
    expect(afterRelease.allowed).toBe(true)
  })

  it('release_rate_limit on an already-expired key is a no-op — it does not resurrect the row', async () => {
    const admin = serviceClient()
    const key = trackedKey('rl-expired-release')

    await check(admin, key, 1, 1)
    await admin
      .from('rate_limit_hits')
      .update({ expire: new Date(Date.now() - 1000).toISOString() })
      .eq('key', key)

    await release(admin, key)

    const { data: row } = await admin
      .from('rate_limit_hits')
      .select('key, points, expire')
      .eq('key', key)
      .maybeSingle()

    // The release's WHERE expire > now() guard means an already-expired row is left
    // exactly as it was — still at its original point count, still expired — rather
    // than being revived with points decremented below the caller's limit.
    expect(row).not.toBeNull()
    expect(row!.points).toBe(1)
    expect(new Date(row!.expire).getTime()).toBeLessThanOrEqual(Date.now())
  })

  it('handles N parallel calls atomically: exactly p_limit succeed, the rest are blocked', async () => {
    const admin = serviceClient()
    const key = trackedKey('rl-concurrent')
    const limit = 5
    const total = 10

    const results = await Promise.all(
      Array.from({ length: total }, () => check(admin, key, limit, 5))
    )

    const allowedCount = results.filter((r) => r.allowed).length
    expect(allowedCount).toBe(limit)
    expect(results.length - allowedCount).toBe(total - limit)
  })

  it('does not share budget between two different tenant-scoped keys for the same phone', async () => {
    const admin = serviceClient()
    const suffix = uniqueKey('shared-phone')
    const keyTenantA = `invite:phone:tenant-a:${suffix}`
    const keyTenantB = `invite:phone:tenant-b:${suffix}`
    createdKeys.push(keyTenantA, keyTenantB)

    const resultA = await check(admin, keyTenantA, 1, 5)
    expect(resultA.allowed).toBe(true)
    const blockedA = await check(admin, keyTenantA, 1, 5)
    expect(blockedA.allowed).toBe(false)

    // Tenant B's identical-phone key must still have its own fresh budget.
    const resultB = await check(admin, keyTenantB, 1, 5)
    expect(resultB.allowed).toBe(true)
  })
})

// The whole access-control model for this table and its two RPCs lives in
// migration 0026's REVOKE statements, not in RLS policies — both RPCs are
// SECURITY DEFINER and the table has no grants for anon/authenticated. This
// asserts that boundary directly against real anon and authenticated clients,
// rather than only ever exercising it via service_role (which bypasses
// REVOKE entirely).
describe('access control: anon/authenticated must be denied', () => {
  const anon: SupabaseClient<Database> = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  )
  let tenantId: string
  let authClient: SupabaseClient<Database>

  beforeAll(async () => {
    const tenant = await createTenant('Rate Limit ACL')
    tenantId = tenant.id
    // Non-admin role deliberately: the REVOKE in migration 0026 applies to
    // the `authenticated` Postgres role itself, not to app-level role
    // checks, so a plain official proves the boundary holds for any
    // authenticated user — not just ones an app-level check might exempt.
    const { phone } = await createUserWithRole(tenantId, 'official')
    authClient = await signInAsClient(phone, '000000')
  })

  afterAll(async () => {
    await cleanupTenant(tenantId)
  })

  it('denies anon select on rate_limit_hits', async () => {
    const { error } = await anon.from('rate_limit_hits').select('*')
    expect(error).not.toBeNull()
  })

  it('denies anon check_rate_limit', async () => {
    const { error } = await anon.rpc('check_rate_limit', {
      p_key: 'anon-probe',
      p_limit: 1,
      p_duration_seconds: 1,
    })
    expect(error).not.toBeNull()
  })

  it('denies anon release_rate_limit', async () => {
    const { error } = await anon.rpc('release_rate_limit', { p_key: 'anon-probe' })
    expect(error).not.toBeNull()
  })

  it('denies authenticated select on rate_limit_hits', async () => {
    const { error } = await authClient.from('rate_limit_hits').select('*')
    expect(error).not.toBeNull()
  })

  it('denies authenticated check_rate_limit', async () => {
    const { error } = await authClient.rpc('check_rate_limit', {
      p_key: 'anon-probe',
      p_limit: 1,
      p_duration_seconds: 1,
    })
    expect(error).not.toBeNull()
  })

  it('denies authenticated release_rate_limit', async () => {
    const { error } = await authClient.rpc('release_rate_limit', { p_key: 'anon-probe' })
    expect(error).not.toBeNull()
  })
})
