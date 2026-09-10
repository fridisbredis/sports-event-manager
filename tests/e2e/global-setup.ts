import { spawnSync } from 'node:child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { SEED_TENANT_SLUG, SYSTEM_ADMIN_PHONE } from './fixtures/users'

// Reads the local stack's credentials the same way scripts/seed-dev-local.mjs
// does. Playwright's globalSetup runs before any test file, in its own process,
// so it cannot lean on the integration suite's setup-env.ts.
function readLocalStackCredentials() {
  const status = spawnSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (status.error || status.status !== 0) {
    throw new Error(
      'Local Supabase stack is not running. Start it first:\n' +
        '  export SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=dummy\n' +
        '  supabase start\n\n' +
        (status.stderr?.trim() || status.error?.message || '')
    )
  }

  const parsed = JSON.parse(status.stdout) as { API_URL?: string; SERVICE_ROLE_KEY?: string }
  const apiUrl = parsed.API_URL
  const serviceRoleKey = parsed.SERVICE_ROLE_KEY

  if (typeof apiUrl !== 'string' || !apiUrl.startsWith('http') || !serviceRoleKey) {
    throw new Error(
      "Could not read local Supabase credentials from 'supabase status -o json'. " +
        'Is the stack fully up? Try: supabase stop && supabase start'
    )
  }

  // Same interlock as tests/integration/setup-env.ts and playwright.config.ts:
  // this setup creates users and seeds data, which must never hit a shared
  // project even if `supabase status` somehow reported a remote URL.
  const host = new URL(apiUrl).hostname
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error(`Refusing to seed ${apiUrl} — E2E setup is local-only.`)
  }

  return { apiUrl, serviceRoleKey }
}

// The seed script is not idempotent: it throws when the tenant already exists,
// on purpose, so nobody silently doubles a tenant's data. For E2E that means
// "seed only when missing" — a reseed between runs would also invalidate the
// storageState cache and slow every run down for no benefit.
async function ensureSeedData(admin: SupabaseClient<Database>) {
  const { data: tenant, error } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', SEED_TENANT_SLUG)
    .maybeSingle()
  if (error) throw error

  if (tenant) return

  console.log(`[e2e] Tenant '${SEED_TENANT_SLUG}' missing — running npm run seed:dev:local…`)
  const seed = spawnSync('npm', ['run', 'seed:dev:local'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (seed.status !== 0) {
    throw new Error('Seeding failed. Run `npm run seed:dev:local` manually to see why.')
  }
}

// scripts/seed-dev.ts seeds no system_admin (the role is global — user_roles
// .tenant_id must be NULL per migration 0021 — so it does not belong to a
// tenant's seed data). SYS-01/SYS-02 are unreachable without one, so the E2E
// suite owns this user. Idempotent: safe across repeated runs.
async function ensureSystemAdmin(admin: SupabaseClient<Database>) {
  const storedPhone = SYSTEM_ADMIN_PHONE.replace(/^\+/, '')

  // GoTrue stores phones without the leading '+', and listUsers() paginates at
  // 50 by default — the local stack holds the seed users plus whatever earlier
  // runs left behind, so page through fully rather than trusting page 1.
  let userId: string | undefined
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = data.users.find((u) => u.phone === storedPhone)
    if (found) {
      userId = found.id
      break
    }
    if (data.users.length < 1000) break
  }

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      phone: SYSTEM_ADMIN_PHONE,
      phone_confirm: true,
    })
    if (error) throw error
    userId = data.user.id
  }

  const { data: existingRole, error: roleReadError } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .eq('role', 'system_admin')
    .maybeSingle()
  if (roleReadError) throw roleReadError

  if (!existingRole) {
    const { error } = await admin
      .from('user_roles')
      .insert({ user_id: userId, tenant_id: null, role: 'system_admin' })
    if (error) throw error
  }
}

// playwright.config.ts checks that the *app* is on localhost, which says
// nothing about which Supabase that app talks to: NEXT_PUBLIC_SUPABASE_URL in
// .env.local points at the dev cloud project by default (the local line is
// commented out), so `npm run dev` on port 3000 will happily authenticate and
// write against dev. Signing in still appears to work there — the seed users
// exist in dev too — so without this check the suite silently exercises a
// shared environment and writes test data into it.
// playwright.config.ts pins the dev server's NEXT_PUBLIC_SUPABASE_URL to the
// local stack, but `reuseExistingServer` means the suite may attach to a dev
// server someone already started by hand — one that read .env.local, where the
// dev *cloud* URL is active and the local one is commented out. Signing in
// still appears to work there (the seed users exist in dev too), so without
// this probe the suite silently exercises a shared project and writes into it.
async function assertAppTargetsLocalSupabase(baseUrl: string, apiUrl: string) {
  // No health endpoint reports which Supabase the server reached, so probe the
  // behaviour instead: ask the running server to send an OTP to a number that
  // exists *only* in the local stack's [auth.sms.test_otp]. The local stack
  // intercepts it and returns ok; the dev cloud project has no such user and
  // rejects it (422 signup_disabled). A wrong-target server is therefore
  // detected before any test signs in.
  const res = await fetch(`${baseUrl}/api/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: SYSTEM_ADMIN_PHONE.replace(/^\+/, '') }),
  }).catch(() => null)

  // Server not up yet — webServer will start one with the right env pinned.
  if (!res) return
  if (res.ok) return

  const body = (await res.json().catch(() => ({}))) as { code?: string }

  // Rate limiting says nothing about the target, and the probe itself consumes
  // one of the 5/hour login sends for this number. Don't fail the run over it.
  if (res.status === 429) return

  throw new Error(
    `A dev server is already running on ${baseUrl}, but it rejected a local-only test number ` +
      `(${res.status}${body.code ? ` ${body.code}` : ''}) — so it is not talking to the local ` +
      `stack (${apiUrl}).\n\n` +
      'It most likely read .env.local, where the dev cloud URL is active and the local one is ' +
      'commented out. Running E2E against dev would sign in as real users and write test data ' +
      'into a shared project.\n\n' +
      'Stop that dev server and let Playwright start its own — playwright.config.ts pins the ' +
      'local stack for the server it launches.'
  )
}

// Login is rate limited to 5 sends and 10 verifies per phone per hour
// (LOGIN_SEND_LIMIT / LOGIN_VERIFY_LIMIT in src/lib/rate-limit.ts). That is a
// production safeguard, and it is right that E2E exercises the real route
// rather than bypassing it — but across repeated local runs the counters
// accumulate and start rejecting sign-ins that have nothing to do with the
// behaviour under test. Clearing them once per run keeps the limiter itself
// testable (rate-limit.test.ts covers the RPC directly) without letting it
// leak between runs.
async function clearLoginRateLimits(admin: SupabaseClient<Database>) {
  const { error } = await admin.from('rate_limit_hits').delete().like('key', 'login:%')
  if (error) throw error
}

export default async function globalSetup() {
  const { apiUrl, serviceRoleKey } = readLocalStackCredentials()

  const admin = createClient<Database>(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Before the probe below, which itself spends one of the 5 hourly sends.
  await clearLoginRateLimits(admin)

  await assertAppTargetsLocalSupabase(process.env.E2E_LOCAL_URL ?? 'http://localhost:3000', apiUrl)

  await ensureSeedData(admin)
  await ensureSystemAdmin(admin)

  // Handed to the auth fixture so it can reach the database without re-reading
  // `supabase status` per worker.
  process.env.E2E_SUPABASE_URL = apiUrl
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey
}
