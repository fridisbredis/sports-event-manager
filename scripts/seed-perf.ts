// Seeds a production-like volume dataset for the PERF-01 read-path measurement.
//
// Usage: npm run seed:perf [-- --events=5 --officials=15 --assignments=200]
//
// This is deliberately NOT part of seed-dev.ts. That script seeds one of each
// invite_status because the app branches on them, and it stays small so manual
// testing is readable. PERF-01 needs the opposite: enough rows that the queries
// dominate the measurement instead of Next.js's fixed render cost.
//
// Volumes come from the figures in docs/quality-requirements.md:
//   - 3 tenant admins and 10-15 officials per event   (confirmed, Viadal)
//   - 5 parallel events                                (confirmed, Frida 2026-08-27)
//   - 200 assignments per event                        (confirmed, Frida 2026-08-27)
// Work areas per event has no confirmed figure; the register's placeholder
// estimate of 10-15 is used and flagged as such in the output, so a reader of
// the measurement report can see which numbers are agreed and which are not.
//
// Localhost only — see scripts/perf-env.ts for why this is stricter than
// seed-dev.ts's guard. Config comes from .env.perf, never .env.local.

import {
  createPerfClient,
  assertScratchDatabase,
  loadPerfEnv,
  PERF_SLUG_PREFIX,
  PERF_PHONE_BASE,
} from './perf-env'

// Resolved inside main() rather than at module scope: a guard failure here is
// expected operator error (no .env.perf yet, wrong URL), and it should print as
// a readable message, not a module-load stack trace.
let SUPABASE_URL: string
let admin: ReturnType<typeof createPerfClient>

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function intArg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))
  if (!raw) return fallback
  const value = Number.parseInt(raw.split('=')[1], 10)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`--${name} must be a non-negative integer, got '${raw.split('=')[1]}'`)
  }
  return value
}

const EVENTS = intArg('events', 5)
const ADMINS_PER_EVENT = intArg('admins', 3)
const OFFICIALS_PER_EVENT = intArg('officials', 15)
const ASSIGNMENTS_PER_EVENT = intArg('assignments', 200)
const WORK_AREAS_PER_EVENT = intArg('workareas', 12)

// Each parallel event is its own tenant: the five events in the confirmed
// figure are different clubs, not five events inside one club. That matters for
// the measurement — RLS and every read filter on tenant_id, so co-locating them
// in one tenant would make the assignments table look 5x deeper to each query
// than it really is and overstate the cost.
const SLUG_PREFIX = PERF_SLUG_PREFIX

let phoneCursor = 0
function nextPhone(): string {
  phoneCursor += 1
  return `+${PERF_PHONE_BASE + phoneCursor}`
}

// officials.phone must match auth.users.phone byte-for-byte — the SEC-04
// confirm RPCs (0017/0018) compare with exact string equality and 0020's
// partial unique index treats '+46…' and '46…' as different strings.
const storedPhone = (phone: string) => phone.replace(/^\+/, '')

const STAGE_DATE = '2026-09-05'
const WINDOW_START = `${STAGE_DATE}T07:00:00Z`
const WINDOW_END = `${STAGE_DATE}T19:00:00Z`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// seed-dev.ts calls listUsers() per user, which is O(n^2) and fine for 4 users
// but not for the ~90 this script creates. One listing up front instead.
let authUserCache: Map<string, string> | null = null

async function loadAuthUsers(): Promise<Map<string, string>> {
  if (authUserCache) return authUserCache
  const cache = new Map<string, string>()
  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    for (const u of data.users) if (u.phone) cache.set(u.phone, u.id)
    if (data.users.length < 1000) break
    page += 1
  }
  authUserCache = cache
  return cache
}

async function createAuthUser(phone: string): Promise<string> {
  const cache = await loadAuthUsers()
  const existing = cache.get(storedPhone(phone))
  if (existing) return existing

  const { data, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true })
  if (error) throw error
  cache.set(storedPhone(phone), data.user.id)
  return data.user.id
}

async function insertMany<T>(table: string, rows: T[], chunk = 500) {
  for (let i = 0; i < rows.length; i += chunk) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await admin.from(table as any).insert(rows.slice(i, i + chunk) as any)
    if (error) throw new Error(`insert into ${table} failed: ${error.message}`)
  }
}

// ---------------------------------------------------------------------------
// Seed one tenant/event
// ---------------------------------------------------------------------------

async function seedTenant(index: number) {
  const slug = `${SLUG_PREFIX}-${index + 1}`

  const { data: existing } = await admin.from('tenants').select('id').eq('slug', slug).maybeSingle()

  if (existing) {
    throw new Error(
      `Tenant '${slug}' already exists (id ${existing.id}). Run 'npm run seed:perf:clean' ` +
        'first if you want to reseed.'
    )
  }

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name: `Perf Tenant ${index + 1}`, slug, is_active: true, tier: 'standard' })
    .select('id')
    .single()
  if (tenantError) throw tenantError

  const { data: event, error: eventError } = await admin
    .from('events')
    .insert({
      tenant_id: tenant.id,
      name: `Perf Race ${index + 1}`,
      event_type: 'race',
      start_date: STAGE_DATE,
      end_date: '2026-09-06',
      location: 'Perf Arena',
      status: 'published',
      scheduling_granularity_min: 60,
    })
    .select('id')
    .single()
  if (eventError) throw eventError

  // One race stage covering the whole day. The scheduling view resolves the
  // selected day from the stage's allocable range (getAllocableDays), so every
  // seeded assignment has to fall inside this window to be fetched at all.
  const { data: stage, error: stageError } = await admin
    .from('event_stages')
    .insert({
      tenant_id: tenant.id,
      event_id: event.id,
      name: 'Race Day',
      stage_type: 'race',
      stage_date: STAGE_DATE,
      start_time: WINDOW_START,
      end_time: WINDOW_END,
      venue: 'Perf Arena',
      position: 0,
    })
    .select('id')
    .single()
  if (stageError) throw stageError

  // Work areas (workstations). event-info reads facilities, the scheduling view
  // reads workstations with their operating windows nested — so both need depth.
  const workstationRows = Array.from({ length: WORK_AREAS_PER_EVENT }, (_, i) => ({
    tenant_id: tenant.id,
    event_id: event.id,
    stage_id: stage.id,
    name: `Work area ${i + 1}`,
    description: `Seeded work area ${i + 1} for PERF-01 volume`,
    capacity_ceiling: 4,
  }))

  const { data: workstations, error: wsError } = await admin
    .from('workstations')
    .insert(workstationRows)
    .select('id')
  if (wsError) throw wsError

  await insertMany(
    'workstation_operating_windows',
    workstations.map((ws) => ({
      workstation_id: ws.id,
      window_start: WINDOW_START,
      window_end: WINDOW_END,
    }))
  )

  // Two todos per work area — the own-schedule read path nests
  // workstation_todos inside workstations, so this is on its hot path.
  await insertMany(
    'workstation_todos',
    workstations.flatMap((ws) => [
      { workstation_id: ws.id, instruction_text: 'Check equipment is powered on', position: 0 },
      {
        workstation_id: ws.id,
        instruction_text: 'Report to area lead at shift start',
        position: 1,
      },
    ])
  )

  // Event facilities — read by event-info.
  await insertMany(
    'event_facilities',
    Array.from({ length: 6 }, (_, i) => ({
      tenant_id: tenant.id,
      event_id: event.id,
      label: `Facility ${i + 1}`,
      position: i,
    }))
  )

  // Tenant admins.
  const adminPhones: string[] = []
  for (let i = 0; i < ADMINS_PER_EVENT; i += 1) {
    const phone = nextPhone()
    const userId = await createAuthUser(phone)
    const { error } = await admin
      .from('user_roles')
      .insert({ user_id: userId, tenant_id: tenant.id, role: 'tenant_admin' })
    if (error) throw error
    adminPhones.push(phone)
  }

  // Officials. All confirmed: only Confirmed officials are schedulable, and
  // canViewOfficialSurfaces requires it for the official screens to render at
  // all. An unconfirmed official would measure a notFound(), not a read path.
  const officialPhones: string[] = []
  const officialIds: string[] = []
  for (let i = 0; i < OFFICIALS_PER_EVENT; i += 1) {
    const phone = nextPhone()
    const userId = await createAuthUser(phone)
    const { error: roleError } = await admin
      .from('user_roles')
      .insert({ user_id: userId, tenant_id: tenant.id, role: 'official' })
    if (roleError) throw roleError

    const { data: official, error: officialError } = await admin
      .from('officials')
      .insert({
        tenant_id: tenant.id,
        user_id: userId,
        name: `Perf Official ${index + 1}-${i + 1}`,
        phone: storedPhone(phone),
        invite_status: 'confirmed',
      })
      .select('id')
      .single()
    if (officialError) throw officialError

    officialPhones.push(phone)
    officialIds.push(official.id)
  }

  // Assignments, spread across work areas, officials and hourly timeslots.
  //
  // uq_assignments_workstation_timeslot_slot (migration 0012) forbids two rows
  // sharing workstation + timeslot + slot_index, so the slot lane is derived
  // from the position within each (work area, hour) cell rather than assigned
  // randomly. Capacity ceiling is 4, and the deliberate over-capacity overflow
  // documented in 0012 is not exercised here — this seed measures reads, and a
  // grid with warnings on every cell is not production-like.
  const HOURS = 12 // 07:00-19:00, matching the operating window
  const assignmentRows: Array<Record<string, unknown>> = []

  for (let n = 0; n < ASSIGNMENTS_PER_EVENT; n += 1) {
    const wsIndex = n % workstations.length
    const hour = Math.floor(n / workstations.length) % HOURS
    // Which pass over this (work area, hour) cell we are on — becomes the slot lane.
    const lane = Math.floor(n / (workstations.length * HOURS))

    if (lane >= 4) {
      throw new Error(
        `--assignments=${ASSIGNMENTS_PER_EVENT} exceeds what ${workstations.length} work areas x ` +
          `${HOURS} hours x capacity 4 can hold (${workstations.length * HOURS * 4}). ` +
          'Raise --workareas or lower --assignments.'
      )
    }

    const start = new Date(`${STAGE_DATE}T07:00:00Z`)
    start.setUTCHours(start.getUTCHours() + hour)
    const end = new Date(start)
    end.setUTCHours(end.getUTCHours() + 1)

    assignmentRows.push({
      tenant_id: tenant.id,
      official_id: officialIds[n % officialIds.length],
      workstation_id: workstations[wsIndex].id,
      timeslot_start: start.toISOString(),
      timeslot_end: end.toISOString(),
      slot_index: lane + 1,
      status: 'assigned',
    })
  }

  await insertMany('assignments', assignmentRows)

  await insertMany(
    'announcements',
    Array.from({ length: 5 }, (_, i) => ({
      tenant_id: tenant.id,
      channel: i % 2 === 0 ? 'officials' : 'participants',
      body: `Seeded announcement ${i + 1} for Perf Race ${index + 1}.`,
      sms_sent: true,
      published_at: new Date(`${STAGE_DATE}T06:00:00Z`).toISOString(),
    }))
  )

  return {
    slug,
    tenantId: tenant.id,
    eventId: event.id,
    adminPhones,
    officialPhones,
    counts: {
      workAreas: workstations.length,
      officials: officialIds.length,
      assignments: assignmentRows.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  SUPABASE_URL = loadPerfEnv().url
  admin = createPerfClient()

  console.log(`Seeding PERF-01 volume data into ${SUPABASE_URL}`)

  // Layer 3 of the guard: the URL being loopback is not proof the database is
  // a scratch one. Verify before writing anything.
  await assertScratchDatabase(admin)

  console.log(
    `  ${EVENTS} events x (${ADMINS_PER_EVENT} admins, ${OFFICIALS_PER_EVENT} officials, ` +
      `${WORK_AREAS_PER_EVENT} work areas, ${ASSIGNMENTS_PER_EVENT} assignments)`
  )
  console.log('')

  const seeded = []
  for (let i = 0; i < EVENTS; i += 1) {
    const result = await seedTenant(i)
    seeded.push(result)
    console.log(
      `  ${result.slug}: ${result.counts.workAreas} work areas, ` +
        `${result.counts.officials} officials, ${result.counts.assignments} assignments`
    )
  }

  const totals = seeded.reduce(
    (acc, s) => ({
      workAreas: acc.workAreas + s.counts.workAreas,
      officials: acc.officials + s.counts.officials,
      assignments: acc.assignments + s.counts.assignments,
    }),
    { workAreas: 0, officials: 0, assignments: 0 }
  )

  console.log('')
  console.log(
    `Total: ${seeded.length} tenants, ${totals.workAreas} work areas, ` +
      `${totals.officials} officials, ${totals.assignments} assignments`
  )
  console.log('')
  console.log('Volume provenance:')
  console.log('  CONFIRMED  events, admins, officials, assignments per event')
  console.log(`  PLACEHOLDER work areas per event (${WORK_AREAS_PER_EVENT}) — no agreed figure`)
  console.log('')

  // The measurement harness needs to sign in as these users, so it needs the
  // phone numbers. Written to stdout as JSON rather than a file so nothing
  // containing phone numbers is created on disk by default.
  const manifest = seeded.map((s) => ({
    slug: s.slug,
    tenantId: s.tenantId,
    eventId: s.eventId,
    adminPhones: s.adminPhones,
    officialPhones: s.officialPhones,
  }))

  console.log('--- MANIFEST (redirect to a file for the perf harness) ---')
  console.log(JSON.stringify(manifest, null, 2))
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
