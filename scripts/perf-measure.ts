// PERF-01 measurement harness: the four core read paths, unloaded then loaded.
//
// Usage:
//   npm run perf:measure                 # baseline + load, default derived mix
//   npm run perf:measure -- --baseline   # unloaded baseline only
//   npm run perf:measure -- --admins=15 --officials=75
//   npm run perf:measure -- --json=out.json
//
// PERF-01 (docs/quality-requirements.md): under the derived concurrent-session
// load, p95 server response time for each read path must be at most 300% of
// that path's own unloaded baseline, with an error rate below 1%.
//
// The 300% ceiling was confirmed by the product owner (Peter, 2026-08-25). The
// LOAD LEVEL is derived from the confirmed volumes (Frida, 2026-08-27) — 3 event
// admins and 10-15 officials per event, 5 parallel events — not from the "50
// concurrent users" figure that earlier appeared in the register, which came
// from a worked example rather than from event volume and has been withdrawn.
//
// Default mix, and why it is a mix at all: 50 officials polling their own
// schedule is a trivial load (one indexed read on their own row); 50 sessions on
// the stage-filtered scheduling view is an entirely different thing. A single
// "N users" number without a role mix produces a figure that can be moved at
// will by choosing the distribution, so the mix is explicit and reported.
//
//   15 admin sessions    (5 events x 3 admins)   -> dashboard, scheduling
//   75 official sessions (5 events x 15 officials) -> own schedule, event info
//
// MEASUREMENT CAVEATS, restated in the report so a reader cannot miss them:
//   * Local stack. Absolute milliseconds are NOT prod's. The 300% ceiling is a
//     ratio against each path's own baseline, which is far more stable across
//     environments than the absolute figures — but this is not a prod number.
//   * Prod runs minReplicas: 1 in Single revision mode, so a real prod run
//     would mix warm and cold pods and put cold starts straight into the p95
//     tail. Measuring locally deliberately excludes that; it isolates the read
//     path's own cost rather than autoscaling behaviour.
//   * Timings are wall-clock from the client, so they include Next.js render,
//     the Supabase round trips, and loopback HTTP. They do not isolate the SQL.
//
// COMPARING TWO RUNS — read this before concluding anything from a delta:
//   * PIN THE REPLICA COUNT AND CPU. Two runs are only comparable if the app
//     was the same size for both. A comparison in this session was invalid
//     because one run had 2 replicas and the other 3; the "regression" was the
//     rig. `az containerapp show --query properties.template.scale` and
//     `...resources` before and after, and record both alongside the numbers.
//   * WATCH THE BASELINE, NOT JUST THE RATIO. The criterion divides by each
//     path's own unloaded baseline, so a genuine improvement can show as a
//     worse percentage: optimise the app and the baseline tightens too. Read
//     the absolute p95 and the `min` column next to the ratio.
//   * `min` IS THE HONEST PER-REQUEST COST. Under saturation p50/p95 measure
//     queueing, not the code. If `min` falls while p50 does not, the change
//     worked and something upstream is the constraint.
//   * DON'T READ THE AVERAGE AGGREGATION AS THE CEILING. The 43-58% figure
//     that led the first PERF-01 pass to rule out CPU came from
//     `az monitor metrics list --metric CpuPercentage --aggregation Average`.
//     Re-run with `--aggregation Maximum` on the same metric and interval and
//     the reading is 20-30 points higher for a comparable load — verified
//     2026-09-02 against the perf environment (PT1M Average 36-58% vs PT1M
//     Maximum 61-69% over the same four minutes). PT1M vs PT5M interval does
//     NOT explain a gap this size: a five-minute maximum can never exceed the
//     maximum of the one-minute buckets it's built from (same verification —
//     PT5M Maximum matched exactly the highest PT1M Maximum in the window).
//     Always request `--aggregation Maximum`, and say so when quoting a CPU
//     figure — an unlabelled percentage is ambiguous between the two.

import { Agent, setGlobalDispatcher } from 'undici'
import { loadPerfEnv, PERF_SLUG_PREFIX } from './perf-env'
import { grantHarnessPassword, signInToJar, type CookieJar } from './perf-auth'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!raw) return fallback
  const value = Number.parseInt(raw.split('=')[1], 10)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer`)
  }
  return value
}

function stringArg(name: string): string | null {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))
  return raw ? raw.split('=')[1] : null
}

const BASELINE_ONLY = process.argv.includes('--baseline')
const ADMIN_SESSIONS = intArg('admins', 15)
const OFFICIAL_SESSIONS = intArg('officials', 75)
const BASELINE_SAMPLES = intArg('samples', 30)
const LOAD_DURATION_S = intArg('duration', 30)
const JSON_OUT = stringArg('json')

// Discarded before statistics: the first request to a route pays one-time
// module and route-tree initialisation even under `next start`, which is not
// what PERF-01 is about.
const WARMUP_SAMPLES = 3

// Node's fetch (undici) opens at most SIX connections per origin by default.
// Every simulated session here targets the same origin, so without this the
// harness funnels all N sessions through 6 sockets and measures its own client
// queue instead of the server.
//
// This is not a hypothetical: the first 90-session run (2026-09-01) reported
// p95 ratios of 2431-3873% with a 0% error rate, while the app's CPU peaked at
// 43% of its limit and the database sat at one active connection. The tell was
// the `min` column — the fastest request under load matched its unloaded
// baseline almost exactly (257 ms vs 256 ms on dashboard), which is queueing,
// not slower work.
//
// Sized above the session count so the client is never the constraint; a run
// that needs more sessions than this should raise it.
const MAX_CLIENT_CONNECTIONS = 512

setGlobalDispatcher(
  new Agent({
    connections: MAX_CLIENT_CONNECTIONS,
    // The default 5s headers timeout would turn a slow-but-succeeding request
    // into a false error and understate the p95 it was meant to record.
    headersTimeout: 120_000,
    bodyTimeout: 120_000,
  })
)

// ---------------------------------------------------------------------------
// Read paths under measurement
// ---------------------------------------------------------------------------

type Role = 'admin' | 'official'

interface ReadPath {
  id: string
  label: string
  role: Role
  /** Built per tenant so each simulated session hits its own tenant's data. */
  path: (slug: string) => string
}

const READ_PATHS: ReadPath[] = [
  {
    id: 'dashboard',
    label: 'Dashboard (EVT-01)',
    role: 'admin',
    path: (slug) => `/${slug}/admin/dashboard`,
  },
  {
    id: 'scheduling',
    label: 'Scheduling, stage-filtered (SCHED-01)',
    role: 'admin',
    path: (slug) => `/${slug}/admin/scheduling`,
  },
  {
    id: 'own-schedule',
    label: 'Own schedule (MYSCH-01)',
    role: 'official',
    path: (slug) => `/${slug}/schedule`,
  },
  {
    id: 'event-info',
    label: 'Event information (INFO-01)',
    role: 'official',
    path: (slug) => `/${slug}/event-info`,
  },
]

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  // Nearest-rank on the sorted sample. With 30+ samples the choice of
  // interpolation method moves p95 by less than the run-to-run variance.
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(rank, sorted.length) - 1]
}

interface Stats {
  n: number
  errors: number
  errorRate: number
  min: number
  p50: number
  p95: number
  max: number
}

function summarise(samples: number[], errors: number): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  const total = samples.length + errors
  return {
    n: samples.length,
    errors,
    errorRate: total === 0 ? 0 : errors / total,
    min: sorted[0] ?? NaN,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? NaN,
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface Session {
  slug: string
  role: Role
  jar: CookieJar
}

interface Timing {
  ms: number
  ok: boolean
  status: number
}

async function timeRequest(appUrl: string, path: string, jar: CookieJar): Promise<Timing> {
  const started = performance.now()
  try {
    const res = await fetch(`${appUrl}${path}`, {
      headers: { Cookie: jar.header },
      // A redirect means the session was not accepted — that is a failed
      // measurement, not a 3xx to follow.
      redirect: 'manual',
      cache: 'no-store',
    })
    // Drain the body: without this the timing excludes streaming the HTML,
    // which is part of the server response time PERF-01 asks about.
    await res.arrayBuffer()
    const ms = performance.now() - started
    return { ms, ok: res.status === 200, status: res.status }
  } catch {
    return { ms: performance.now() - started, ok: false, status: 0 }
  }
}

// ---------------------------------------------------------------------------
// Session setup
// ---------------------------------------------------------------------------

interface TenantSeed {
  slug: string
  adminPhones: string[]
  officialPhones: string[]
}

async function discoverSeededTenants(): Promise<TenantSeed[]> {
  const { url, serviceRoleKey } = loadPerfEnv()
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: tenants, error } = await admin
    .from('tenants')
    .select('id, slug')
    .like('slug', `${PERF_SLUG_PREFIX}-%`)
    .order('slug')

  if (error) throw new Error(`Could not read seeded tenants: ${error.message}`)

  if (!tenants || tenants.length === 0) {
    throw new Error(
      `No tenants matching '${PERF_SLUG_PREFIX}-%'. Run 'npm run seed:perf' before measuring.`
    )
  }

  const seeds: TenantSeed[] = []

  for (const tenant of tenants) {
    // Admin phones come from user_roles -> auth.users; officials from the
    // officials table, which stores the phone without the '+'.
    const { data: roles, error: rolesError } = await admin
      .from('user_roles')
      .select('user_id')
      .eq('tenant_id', tenant.id)
      .eq('role', 'tenant_admin')

    if (rolesError) throw new Error(`Could not read admin roles: ${rolesError.message}`)

    const { data: officials, error: officialsError } = await admin
      .from('officials')
      .select('phone')
      .eq('tenant_id', tenant.id)
      .eq('invite_status', 'confirmed')
      .order('name')

    if (officialsError) throw new Error(`Could not read officials: ${officialsError.message}`)

    const adminIds = new Set((roles ?? []).map((r) => r.user_id))
    const adminPhones: string[] = []

    let page = 1
    for (;;) {
      const { data, error: usersError } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (usersError) throw usersError
      for (const u of data.users) {
        if (adminIds.has(u.id) && u.phone) adminPhones.push(`+${u.phone}`)
      }
      if (data.users.length < 1000) break
      page += 1
    }

    seeds.push({
      slug: tenant.slug,
      adminPhones,
      officialPhones: (officials ?? []).map((o) => `+${o.phone.replace(/^\+/, '')}`),
    })
  }

  return seeds
}

/**
 * Builds the requested number of sessions, spread round-robin across tenants so
 * load lands on all five events rather than piling onto one.
 */
async function buildSessions(seeds: TenantSeed[], role: Role, count: number): Promise<Session[]> {
  const pool: Array<{ slug: string; phone: string }> = []

  // Interleave by tenant: tenant1[0], tenant2[0], …, tenant1[1], tenant2[1], …
  const maxPer = Math.max(
    ...seeds.map((s) => (role === 'admin' ? s.adminPhones : s.officialPhones).length)
  )
  for (let i = 0; i < maxPer; i += 1) {
    for (const seed of seeds) {
      const phones = role === 'admin' ? seed.adminPhones : seed.officialPhones
      if (i < phones.length) pool.push({ slug: seed.slug, phone: phones[i] })
    }
  }

  if (pool.length === 0) {
    throw new Error(`No seeded ${role} users found. Run 'npm run seed:perf'.`)
  }

  const sessions: Session[] = []
  for (let i = 0; i < count; i += 1) {
    // Reuse users cyclically if more sessions than users are requested — a real
    // admin can have several browser tabs open, which is what the register's
    // "padded to 5 for headroom, e.g. multiple sessions per admin" describes.
    const { slug, phone } = pool[i % pool.length]
    await grantHarnessPassword(phone)
    const jar = await signInToJar(phone)
    sessions.push({ slug, role, jar })
  }

  return sessions
}

// ---------------------------------------------------------------------------
// Phase 1: unloaded baseline
// ---------------------------------------------------------------------------

async function measureBaseline(
  appUrl: string,
  sessions: Record<Role, Session[]>
): Promise<Record<string, Stats>> {
  const results: Record<string, Stats> = {}

  for (const readPath of READ_PATHS) {
    const session = sessions[readPath.role][0]
    const url = readPath.path(session.slug)

    // Warm up, discarded.
    for (let i = 0; i < WARMUP_SAMPLES; i += 1) {
      await timeRequest(appUrl, url, session.jar)
    }

    const samples: number[] = []
    let errors = 0
    const statuses = new Set<number>()

    // Strictly serial: an unloaded baseline must have no concurrency of its own.
    for (let i = 0; i < BASELINE_SAMPLES; i += 1) {
      const t = await timeRequest(appUrl, url, session.jar)
      statuses.add(t.status)
      if (t.ok) samples.push(t.ms)
      else errors += 1
    }

    if (samples.length === 0) {
      throw new Error(
        `Every baseline request to ${url} failed (statuses: ${[...statuses].join(', ')}). ` +
          'A 307 means the session was rejected; a 404 means the tenant-authorization layout ' +
          'denied access — check that the seeded user holds the right role for this tenant.'
      )
    }

    results[readPath.id] = summarise(samples, errors)
    const s = results[readPath.id]
    console.log(
      `  ${readPath.label.padEnd(42)} p50 ${s.p50.toFixed(1).padStart(7)} ms   ` +
        `p95 ${s.p95.toFixed(1).padStart(7)} ms   (n=${s.n}${s.errors ? `, ${s.errors} err` : ''})`
    )
  }

  return results
}

// ---------------------------------------------------------------------------
// Phase 2: under load
// ---------------------------------------------------------------------------

async function measureUnderLoad(
  appUrl: string,
  sessions: Record<Role, Session[]>
): Promise<Record<string, Stats>> {
  const collected: Record<string, { samples: number[]; errors: number }> = {}
  for (const p of READ_PATHS) collected[p.id] = { samples: [], errors: 0 }

  const deadline = performance.now() + LOAD_DURATION_S * 1000
  const pathsByRole: Record<Role, ReadPath[]> = {
    admin: READ_PATHS.filter((p) => p.role === 'admin'),
    official: READ_PATHS.filter((p) => p.role === 'official'),
  }

  // Every session loops over its role's paths until the deadline. All sessions
  // run concurrently, so the offered load is the full session count throughout
  // — this is the "loaded" condition the 300% ratio is measured against.
  async function driveSession(session: Session) {
    const paths = pathsByRole[session.role]
    let i = 0
    while (performance.now() < deadline) {
      const readPath = paths[i % paths.length]
      i += 1
      const t = await timeRequest(appUrl, readPath.path(session.slug), session.jar)
      if (t.ok) collected[readPath.id].samples.push(t.ms)
      else collected[readPath.id].errors += 1
    }
  }

  const all = [...sessions.admin, ...sessions.official]
  await Promise.all(all.map(driveSession))

  const results: Record<string, Stats> = {}
  for (const p of READ_PATHS) {
    results[p.id] = summarise(collected[p.id].samples, collected[p.id].errors)
  }
  return results
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const CEILING_PCT = 300

function report(
  baseline: Record<string, Stats>,
  loaded: Record<string, Stats> | null,
  appUrl: string
) {
  console.log('')
  console.log('='.repeat(78))
  console.log('PERF-01 — core read paths')
  console.log('='.repeat(78))

  if (!loaded) {
    console.log('')
    console.log('Baseline only (--baseline). No verdict: the 300% ceiling needs a loaded run.')
    return true
  }

  console.log('')
  console.log(`Ceiling: p95 under load <= ${CEILING_PCT}% of that path's own unloaded baseline,`)
  console.log('         error rate < 1%. Confirmed by Peter Thorn 2026-08-25.')
  console.log('')
  console.log(
    'Read path                                   base p95   load p95      %  errors  verdict'
  )
  console.log('-'.repeat(78))

  let allPass = true

  for (const p of READ_PATHS) {
    const b = baseline[p.id]
    const l = loaded[p.id]
    const pct = (l.p95 / b.p95) * 100
    const errPct = l.errorRate * 100
    const pass = pct <= CEILING_PCT && errPct < 1
    if (!pass) allPass = false

    console.log(
      `${p.label.padEnd(42)}` +
        `${b.p95.toFixed(0).padStart(7)} ` +
        `${l.p95.toFixed(0).padStart(10)} ` +
        `${pct.toFixed(0).padStart(6)}% ` +
        `${errPct.toFixed(1).padStart(6)}% ` +
        `  ${pass ? 'PASS' : 'FAIL'}`
    )
  }

  console.log('-'.repeat(78))
  console.log('')
  console.log(`Verdict: ${allPass ? 'PASS' : 'FAIL'}`)
  console.log('')
  console.log("Read these numbers with the caveats in this script's header:")
  console.log(`  * Measured against ${appUrl}`)
  console.log('  * Absolute ms depend on the environment; the 300% ratio is the criterion.')
  console.log('  * Cold starts are largely excluded by a warm replica floor. A prod run')
  console.log('    with a cold pod would put that start-up cost into the p95 tail.')

  return allPass
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  loadPerfEnv() // asserts localhost before anything else

  const appUrl = process.env.PERF_APP_URL
  if (!appUrl) {
    throw new Error('.env.perf must define PERF_APP_URL (see .env.perf.example).')
  }

  // Fail early and clearly if the app is not up, rather than reporting a run
  // where every request failed.
  try {
    const res = await fetch(`${appUrl}/api/health`, { cache: 'no-store' })
    if (!res.ok) throw new Error(`health check returned ${res.status}`)
  } catch (err) {
    throw new Error(
      `Cannot reach the app at ${appUrl} (${err instanceof Error ? err.message : err}).\n` +
        'Start it with `npm run build && npm start` — not `next dev`, whose on-demand\n' +
        'compilation would land entirely in the p95 tail.'
    )
  }

  console.log('Discovering seeded tenants…')
  const seeds = await discoverSeededTenants()
  console.log(
    `  ${seeds.length} tenants, ` +
      `${seeds.reduce((n, s) => n + s.adminPhones.length, 0)} admins, ` +
      `${seeds.reduce((n, s) => n + s.officialPhones.length, 0)} confirmed officials`
  )

  console.log('')
  console.log(`Signing in ${ADMIN_SESSIONS} admin + ${OFFICIAL_SESSIONS} official sessions…`)
  const sessions: Record<Role, Session[]> = {
    admin: await buildSessions(seeds, 'admin', ADMIN_SESSIONS),
    official: await buildSessions(seeds, 'official', OFFICIAL_SESSIONS),
  }
  console.log(`  ${sessions.admin.length + sessions.official.length} sessions ready`)

  console.log('')
  console.log(`Phase 1 — unloaded baseline (${BASELINE_SAMPLES} serial samples per path)`)
  const baseline = await measureBaseline(appUrl, sessions)

  let loaded: Record<string, Stats> | null = null

  if (!BASELINE_ONLY) {
    console.log('')
    console.log(
      `Phase 2 — under load (${sessions.admin.length + sessions.official.length} concurrent ` +
        `sessions, ${LOAD_DURATION_S}s)`
    )
    loaded = await measureUnderLoad(appUrl, sessions)
    for (const p of READ_PATHS) {
      const s = loaded[p.id]
      console.log(
        `  ${p.label.padEnd(42)} p50 ${s.p50.toFixed(1).padStart(7)} ms   ` +
          `p95 ${s.p95.toFixed(1).padStart(7)} ms   (n=${s.n}${s.errors ? `, ${s.errors} err` : ''})`
      )
    }
  }

  const passed = report(baseline, loaded, appUrl)

  if (JSON_OUT) {
    const fs = await import('fs')
    const payload = {
      // No Date.now() concerns here — this is a plain script, not a workflow.
      measuredAt: new Date().toISOString(),
      appUrl,
      ceilingPct: CEILING_PCT,
      sessions: { admin: sessions.admin.length, official: sessions.official.length },
      volumes: { tenants: seeds.length },
      baseline,
      loaded,
      passed,
    }
    fs.writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2))
    console.log('')
    console.log(`Wrote ${JSON_OUT}`)
  }

  if (!passed) process.exitCode = 1
}

main().catch((err) => {
  console.error('')
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
