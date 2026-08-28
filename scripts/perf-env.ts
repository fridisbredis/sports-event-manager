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
//   1. Localhost only. The dev project is NOT on the allowlist. There is no
//      flag to widen this — seeding volume into a shared environment is not a
//      thing anyone should reach for by accident, and a deliberate exception
//      belongs in a one-off command, not a permanent escape hatch.
//   2. Config comes from .env.perf, never .env.local, so a cloud URL is never
//      even loaded into the process.
//   3. The database is inspected before writing: if it contains tenants this
//      script did not create, it is not a scratch database and we stop.
//
// Layers 1 and 2 each independently prevent the near-miss; 3 catches the case
// where someone points a local-looking URL at something real (a tunnel, a port
// forward, a rewritten hosts entry).

import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

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

  // Layer 1: localhost only.
  const parsed = new URL(url)
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run against ${url}.\n\n` +
        'The perf scripts are localhost-only. They seed production-like volume, which does not ' +
        'belong in the dev project that other people test against (nor, obviously, in prod).\n\n' +
        'Start the local stack with `supabase start` and point PERF_SUPABASE_URL at it ' +
        '(http://127.0.0.1:54321).'
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
