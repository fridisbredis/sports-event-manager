// Environment guard for the PERF-01 volume scripts.
//
// This exists because of a near-miss: .env.local points at the *dev cloud
// project* (that is what running the app locally against dev data requires),
// and seed-dev.ts's guard allows both dev and localhost. For a 4-row functional
// seed that is fine and deliberate. For a volume seed it is not — running it
// against dev would have written ~1000 assignments and ~90 auth users into the
// environment two colleagues test against, and officials_tenant_phone_active_uniq
// makes that non-trivial to unpick.
//
// So the perf scripts get a stricter contract than seed-dev.ts:
//
//   1. Localhost, or the ONE named dedicated perf project. The dev and prod
//      projects are NOT on the allowlist and there is no flag that can add
//      them — seeding volume into a shared environment is not a thing anyone
//      should reach for by accident.
//   2. Config comes from .env.perf, never .env.local, so dev's URL is never
//      even loaded into the process.
//   3. The database is inspected before writing: if it contains tenants this
//      script did not create, it is not a scratch database and we stop.
//
// Layers 1 and 2 each independently prevent the near-miss; 3 catches the case
// where someone points an allowed-looking URL at something real (a tunnel, a
// port forward, a rewritten hosts entry) — and it is layer 3, not layer 1,
// that makes widening the host rule safe.
//
// WHY THE HOST RULE WAS WIDENED (2026-09-01)
//
// PERF-01 cannot be signed off from localhost. The local stack runs
// max_connections=100 with no pooler and a PostgREST pool of 10, so every run
// at the required 90 sessions measures connection exhaustion rather than the
// read paths (docs/quality-requirements.md, "Environment"). The requirement's
// own verification line asks for a load test against staging.
//
// The answer is a DEDICATED, DISPOSABLE project that exists only for this
// measurement — not a relaxation of the rule. It is allowlisted by exact
// project ref below, so the check still names one specific database rather
// than trusting whatever is in .env.perf. Layer 3 continues to apply to it
// unchanged: if someone points this ref at a database holding real tenants,
// the seed still refuses.

import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

/**
 * The one hosted project the perf scripts may touch: a dedicated, disposable
 * instance created for the PERF-01 load run (2026-09-01), holding nothing but
 * seeded volume data.
 *
 * This is an exact-ref allowlist, deliberately not a "isn't dev or prod" rule
 * and not an env-var override — either of those would let a typo or a copied
 * config reach a real database. Adding an entry here is a code change that
 * shows up in review.
 *
 * Dev (lhflutwvwvzawzbcuwup) and prod must never be added.
 */
const ALLOWED_HOSTED_REFS = new Set(['jsusfleoufnjfrgsshmi'])

const FORBIDDEN_HOSTED_REFS = new Set(['lhflutwvwvzawzbcuwup'])

/** Supabase project URLs are https://<ref>.supabase.co */
function hostedProjectRef(hostname: string): string | null {
  const match = /^([a-z0-9]+)\.supabase\.co$/.exec(hostname)
  return match ? match[1] : null
}

/** Slug prefix owned by the perf scripts. Shared so the guard and the cleanup agree. */
export const PERF_SLUG_PREFIX = 'perf-tenant'

/**
 * Phone pool for perf data, disjoint from seed-dev.ts (+4670990xxxx) and the
 * integration test pool (+46700000001-10, tests/integration/helpers.ts).
 */
export const PERF_PHONE_BASE = 46_720_000_000
export const PERF_PHONE_PREFIX = '4672000'

const ENV_FILE = '.env.perf'

export function loadPerfEnv(): { url: string; serviceRoleKey: string } {
  const envPath = path.resolve(import.meta.dirname, `../${ENV_FILE}`)

  if (!fs.existsSync(envPath)) {
    throw new Error(
      `Missing ${ENV_FILE}. The perf scripts deliberately do not read .env.local, which points ` +
        `at the dev cloud project.\n\n  cp ${ENV_FILE}.example ${ENV_FILE}\n\n` +
        "The defaults in the example file are the Supabase CLI's fixed local values and work " +
        'as-is once `supabase start` is running.'
    )
  }

  // override: true so an inherited NEXT_PUBLIC_SUPABASE_URL from the shell (or
  // a previously loaded .env.local) cannot win over the file.
  config({ path: envPath, override: true })

  const url = process.env.PERF_SUPABASE_URL
  const serviceRoleKey = process.env.PERF_SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new Error(
      `${ENV_FILE} must define PERF_SUPABASE_URL and PERF_SUPABASE_SERVICE_ROLE_KEY. ` +
        `Note the PERF_ prefix — the names differ from .env.local's on purpose, so a copied ` +
        'cloud config does not silently satisfy them.'
    )
  }

  // Layer 1: localhost, or the one allowlisted dedicated perf project.
  const parsed = new URL(url)
  const ref = hostedProjectRef(parsed.hostname)

  if (ref && FORBIDDEN_HOSTED_REFS.has(ref)) {
    throw new Error(
      `Refusing to run against the dev project (${ref}).\n\n` +
        'The perf scripts seed ~1000 assignments and ~90 auth users. That does not belong in ' +
        'the environment colleagues test against, and officials_tenant_phone_active_uniq makes ' +
        'it non-trivial to unpick afterwards.\n\n' +
        'Use the dedicated perf project, or a local stack.'
    )
  }

  const allowed =
    LOOPBACK_HOSTNAMES.has(parsed.hostname) || (ref !== null && ALLOWED_HOSTED_REFS.has(ref))

  if (!allowed) {
    throw new Error(
      `Refusing to run against ${url}.\n\n` +
        'The perf scripts accept only a local stack or the dedicated perf project ' +
        `(${[...ALLOWED_HOSTED_REFS].join(', ')}). They seed production-like volume, which does ` +
        'not belong in any environment anyone else uses.\n\n' +
        'For a local run: `supabase start`, then point PERF_SUPABASE_URL at ' +
        'http://127.0.0.1:54321.'
    )
  }

  return { url, serviceRoleKey }
}

export function createPerfClient(): SupabaseClient<Database> {
  const { url, serviceRoleKey } = loadPerfEnv()
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Layer 3: refuse to touch a database that holds data the perf scripts did not
 * create. A local stack is either empty or holds only perf tenants; anything
 * else means the URL is not pointing where the caller thinks it is.
 *
 * seed-dev.ts's tenant ('seed-klubben') is tolerated: sharing a local stack
 * between the functional seed and the perf seed is legitimate, and the perf
 * data is namespaced away from it.
 */
const TOLERATED_SLUGS = new Set(['seed-klubben'])

export async function assertScratchDatabase(client: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await client.from('tenants').select('slug')

  if (error) {
    throw new Error(
      `Could not inspect the database before seeding: ${error.message}\n` +
        'Refusing to continue — the safety check has to pass, not just not-fail.'
    )
  }

  const foreign = (data ?? [])
    .map((row) => row.slug)
    .filter((slug) => !slug.startsWith(`${PERF_SLUG_PREFIX}-`) && !TOLERATED_SLUGS.has(slug))

  if (foreign.length > 0) {
    throw new Error(
      `Refusing to seed: this database holds ${foreign.length} tenant(s) the perf scripts did ` +
        `not create — ${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? ', …' : ''}.\n\n` +
        'That means PERF_SUPABASE_URL resolves to a loopback address but reaches a real ' +
        'database (a tunnel, a port-forward, a rewritten hosts entry), or someone has been ' +
        'working in this local stack. Either way, volume seeding is not safe here.'
    )
  }
}
