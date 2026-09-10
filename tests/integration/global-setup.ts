import { config } from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'

/**
 * Reclaims the fixed test-OTP phone pool once, before the whole suite runs.
 *
 * Why this exists: `claimTestPhone` in ./helpers.ts falls back to evicting the
 * oldest number it has claimed *in this process* when every number in the pool
 * is taken. That fallback cannot see users left behind by an earlier run — a
 * file that threw before its `afterAll`, or a suite killed with Ctrl-C — so
 * those users sit in the pool forever, permanently shrinking it. Once the
 * leftovers outnumber the slack, the eviction path starts firing during a
 * normal run and deletes a fixture user that a signed-in client is still
 * using. The client keeps its JWT, so `auth.uid()` then points at a deleted
 * user, `get_user_role()` returns NULL, and RLS rejects the write with a bare
 * 42501 — several files away from the fixture that actually got evicted, and
 * with nothing in the failure pointing at the phone pool.
 *
 * CI never saw this: it starts from a fresh Supabase stack every time, so the
 * pool is always empty. It only bites locally, where the GoTrue container
 * persists users between runs, and it presents as unrelated tests failing at
 * random.
 *
 * Deleting leftovers here rather than widening the pool: a bigger pool only
 * moves the threshold, since nothing reclaims a leaked number. Starting each
 * run from an empty pool removes the eviction path's reason to fire at all.
 */

// globalSetup runs in its own process, before setupFiles — so the env loading
// and the local-only interlock from ./setup-env.ts have not run yet and have
// to be repeated here rather than imported for their side effects.
const envPath = path.resolve(import.meta.dirname, '../../.env.test.local')

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

// Matches the pool in ./helpers.ts. GoTrue stores phones without the '+', and
// this is deliberately anchored so it can never match a real-looking number:
// only +4670000000N and +46700000010 (the exact pool) are eligible.
const TEST_PHONE_PATTERN = /^4670000000(?:[1-9]|10)$/

export default async function setup() {
  const result = config({ path: envPath, override: true })
  if (result.error) {
    // Let ./setup-env.ts own the actionable error message for a missing env
    // file — it runs next and explains how to regenerate it.
    return
  }

  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) return

  // Same interlock as ./setup-env.ts: this deletes auth users with the
  // service-role key, so it must never run against a shared project. No
  // ALLOW_NON_LOCAL_SUPABASE escape hatch here — reclaiming a phone pool is
  // never a thing to do deliberately against dev or prod.
  if (!LOOPBACK_HOSTNAMES.has(new URL(url).hostname)) {
    throw new Error(
      `Refusing to reclaim the test phone pool: SUPABASE_URL (${url}) is not local ` +
        `(hostname must be one of ${Array.from(LOOPBACK_HOSTNAMES).join(', ')}). ` +
        'This deletes auth users with the service-role key.'
    )
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await admin.auth.admin.listUsers()
  if (error) throw error

  const leftovers = (data?.users ?? []).filter((u) => u.phone && TEST_PHONE_PATTERN.test(u.phone))
  if (leftovers.length === 0) return

  for (const user of leftovers) {
    // user_roles first: it FKs to auth.users, and its rows are what
    // get_user_role() reads, so a half-deleted user must not stay authorized.
    await admin.from('user_roles').delete().eq('user_id', user.id)
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id)
    if (deleteError) throw deleteError
  }

  console.info(
    `[global-setup] reclaimed ${leftovers.length} leftover test phone number(s) from a previous run`
  )
}
