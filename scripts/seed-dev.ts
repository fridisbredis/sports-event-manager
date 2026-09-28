// Seeds the dev Supabase project with a realistic tenant for manual testing.
//
// Usage: npm run seed:dev        (dev cloud project)
//        npm run seed:dev:local  (local stack — wrapper overrides env, same script)
//
// Safe by construction: refuses to run against anything that isn't the known
// dev project ref or a local Supabase instance. There is no seed:prod.

import { config } from 'dotenv'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'

config({ path: path.resolve(import.meta.dirname, '../.env.local') })

const DEV_PROJECT_REF = 'lhflutwvwvzawzbcuwup'
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
}

const url = new URL(SUPABASE_URL)
const isDevProject = url.hostname === `${DEV_PROJECT_REF}.supabase.co`
const isLocal = LOOPBACK_HOSTNAMES.has(url.hostname)

if (!isDevProject && !isLocal) {
  throw new Error(
    `Refusing to seed ${SUPABASE_URL} — this script only runs against the dev project ` +
      `(${DEV_PROJECT_REF}.supabase.co) or a local Supabase instance. ` +
      'There is no seed script for prod, on purpose.'
  )
}

const admin = createClient<Database>(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Fixed block of numbers reserved for seed data, disjoint from the
// integration test pool (+46700000001-10, see tests/integration/helpers.ts)
// so the two never collide when run against the same project.
//
// Every number here needs a matching entry under [auth.sms.test_otp] in
// supabase/config.toml, or it cannot be logged in as on the local stack.
const SEED_PHONES = {
  tenantAdmin: '+46709900001',
  officialConfirmed: '+46709900002',
  officialInvited: '+46709900003',
  officialRemoved: '+46709900004',
  officialSingleDay: '+46709900005',
  officialNoShifts: '+46709900006',
} as const

// SEED_PHONES keeps the '+' because auth.admin.createUser() wants canonical E.164, but
// officials.phone must match auth.users.phone byte-for-byte: the SEC-04 confirm RPCs
// (0017/0018) compare them with exact string equality, and 0020's partial unique index
// treats '+46…' and '46…' as different strings. The values above are already E.164, so
// only the leading '+' has to go — this is the same shape normalizePhoneToE164 stores.
const storedPhone = (phone: string) => phone.replace(/^\+/, '')

// The app sets a 7-day window when it creates an invite (officials/route.ts). 0017 raises
// 'expired' when this column is NULL — and that check runs *before* the phone check, so an
// invited row without it is unconfirmable whatever the phone format is. The column has no
// database default (0010), so the seed has to set it explicitly.
const inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

// Relative dates, never literals. MYSCH-01 resolves its default day with
// `new Date().toISOString().slice(0, 10)` (schedule/page.tsx), so shifts have to
// land on today's *UTC* date or the "default to today" branch is untestable —
// and a hardcoded date stops exercising it the moment that date passes.
// Three days is the minimum that renders a day selector at all: DaySelector
// returns null below two days, so the single-day seed this replaced made the
// whole feature invisible.
const SEED_DAYS = [0, 1, 2].map((offset) => {
  const day = new Date()
  day.setUTCHours(0, 0, 0, 0)
  day.setUTCDate(day.getUTCDate() + offset)
  return day.toISOString().slice(0, 10)
})
const [day0, day1, day2] = SEED_DAYS

// 'YYYY-MM-DD' plus 'HH:MM' -> a UTC timestamptz literal.
const at = (day: string, time: string) => `${day}T${time}:00Z`

async function upsertAuthUser(phone: string) {
  const { data: existing } = await admin.auth.admin.listUsers()
  const found = existing.users.find((u) => u.phone === phone.replace('+', ''))
  if (found) return found.id

  const { data, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true })
  if (error) throw error
  return data.user.id
}

// A confirmed official who can actually log in: auth user + 'official' role +
// a confirmed officials row. resolveOfficialSurfaceAccess (src/lib/auth/tenant.ts)
// matches on user_id + tenant_id + invite_status='confirmed' and never reads the
// phone, so these three rows are exactly what the official surfaces require.
async function createConfirmedOfficial(tenantId: string, name: string, phone: string) {
  const userId = await upsertAuthUser(phone)

  const { error: roleError } = await admin
    .from('user_roles')
    .insert({ user_id: userId, tenant_id: tenantId, role: 'official' })
  if (roleError) throw roleError

  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      name,
      phone: storedPhone(phone),
      invite_status: 'confirmed',
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL} ...`)

  const slug = 'seed-klubben'
  const { data: existingTenant } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existingTenant) {
    throw new Error(
      `Tenant '${slug}' already exists (id ${existingTenant.id}). ` +
        'Delete it first (cascades to all its data) if you want to reseed, e.g.:\n' +
        `  delete from tenants where slug = '${slug}';`
    )
  }

  const { data: tenant, error: tenantError } = await admin
    .from('tenants')
    .insert({ name: 'Seed Klubben', slug, is_active: true, tier: 'standard' })
    .select()
    .single()
  if (tenantError) throw tenantError
  console.log(`  tenant: ${tenant.name} (${tenant.id})`)

  const { data: event, error: eventError } = await admin
    .from('events')
    .insert({
      tenant_id: tenant.id,
      name: 'Seed Race 2026',
      event_type: 'race',
      start_date: day0,
      end_date: day2,
      location: 'Seed Stadium',
      status: 'published',
      scheduling_granularity_min: 60,
    })
    .select()
    .single()
  if (eventError) throw eventError
  console.log(`  event: ${event.name} (${event.id}) ${day0} -> ${day2}`)

  // One race stage per day. start_time/end_time are timestamptz (0007) and used
  // to be left NULL, which made getAllocableRange return null and left
  // admin/scheduling with no grid to draw. 0007's `end_time >= start_time`
  // check is satisfied by construction. stage_type and race_type are omitted on
  // purpose — their defaults ('race', 'distance') are what keeps a published
  // event's "at least one Race stage" rule satisfied.
  const { data: stageRows, error: stageError } = await admin
    .from('event_stages')
    .insert(
      SEED_DAYS.map((day, index) => ({
        tenant_id: tenant.id,
        event_id: event.id,
        name: `Day ${index + 1}`,
        stage_date: day,
        start_time: at(day, '07:00'),
        end_time: at(day, '18:00'),
        venue: 'Seed Stadium',
        position: index,
      }))
    )
    .select()
  if (stageError) throw stageError
  console.log(`  stages: ${SEED_DAYS.join(', ')} (07:00-18:00Z each)`)

  // Same reasoning as workstationByName below: RETURNING order is not
  // guaranteed, so look stages up by name rather than by position.
  const stageByName = (name: string): Database['public']['Tables']['event_stages']['Row'] => {
    const found = stageRows.find((row) => row.name === name)
    if (!found) throw new Error(`Stage '${name}' missing after insert`)
    return found
  }
  const day1Stage = stageByName('Day 1')
  const day2Stage = stageByName('Day 2')
  const day3Stage = stageByName('Day 3')

  // Work areas belong to a stage (v0.7 stage model), and WS-01 groups the list
  // by stage: `workstations.filter(ws => ws.stage_id === stage.id)`. A work
  // area with a NULL stage_id therefore belongs to no group and never renders —
  // the screen reports "0 work areas" for every stage while the rows sit in the
  // database. SCHED-01 is scoped per stage too, so stageless work areas leave
  // its grid with nothing to assign against.
  //
  // One set of work areas per stage rather than two shared across all three
  // days. A work area cannot span stages (single stage_id), and its operating
  // windows have to fall inside its own stage's range, so "the same work area
  // on two days" is not expressible in this model — the MYSCH-01 fixture below
  // gets its multi-day case from same-named work areas on different stages
  // instead.
  const WORK_AREA_TEMPLATES = [
    { name: 'Finish line', description: 'Timing and finish chute', capacity_ceiling: 4 },
    {
      name: 'Water station',
      description: 'Cups, jugs and refill point at 5 km',
      capacity_ceiling: 2,
    },
  ]

  const { data: workstationRows, error: wsError } = await admin
    .from('workstations')
    .insert(
      stageRows.flatMap((stage) =>
        WORK_AREA_TEMPLATES.map((template) => ({
          tenant_id: tenant.id,
          event_id: event.id,
          stage_id: stage.id,
          ...template,
        }))
      )
    )
    .select()
  if (wsError) throw wsError

  // Keyed on (stage, name) rather than position: a multi-row insert's RETURNING
  // order is not guaranteed, and the same names now recur once per stage, so
  // name alone no longer identifies a row.
  const workstationOn = (
    stageId: string,
    name: string
  ): Database['public']['Tables']['workstations']['Row'] => {
    const found = workstationRows.find((row) => row.stage_id === stageId && row.name === name)
    if (!found) throw new Error(`Workstation '${name}' missing on stage ${stageId}`)
    return found
  }

  const finishLineDay1 = workstationOn(day1Stage.id, 'Finish line')
  const waterStationDay1 = workstationOn(day1Stage.id, 'Water station')
  const finishLineDay2 = workstationOn(day2Stage.id, 'Finish line')
  const waterStationDay3 = workstationOn(day3Stage.id, 'Water station')
  console.log(
    `  workstations: ${WORK_AREA_TEMPLATES.length} per stage ` +
      `(${workstationRows.length} total across ${stageRows.length} stages)`
  )

  // One operating window per work area, on its own stage's day. A window has to
  // sit inside its stage's allocable range (WS-02 enforces this), so the
  // earlier every-work-area-times-every-day fixture would now produce windows
  // outside the owning stage.
  const stageDateById = new Map(
    stageRows.map((stage) => {
      if (!stage.stage_date) throw new Error(`Stage '${stage.name}' has no stage_date`)
      return [stage.id, stage.stage_date]
    })
  )

  const { error: windowError } = await admin.from('workstation_operating_windows').insert(
    workstationRows.map((ws) => {
      const day = stageDateById.get(ws.stage_id!)
      if (!day) throw new Error(`Workstation '${ws.name}' has no resolvable stage date`)
      return {
        workstation_id: ws.id,
        window_start: at(day, '07:00'),
        window_end: at(day, '18:00'),
      }
    })
  )
  if (windowError) throw windowError

  const { data: todoRows, error: todoError } = await admin
    .from('workstation_todos')
    .insert([
      {
        workstation_id: finishLineDay1.id,
        instruction_text: 'Confirm timing gate is powered on',
        position: 0,
      },
      {
        workstation_id: finishLineDay1.id,
        instruction_text: 'Log finish times on the paper backup sheet',
        position: 1,
      },
      {
        workstation_id: waterStationDay1.id,
        instruction_text: 'Refill jugs before each wave',
        position: 0,
      },
      {
        workstation_id: waterStationDay1.id,
        instruction_text: 'Bag and remove used cups',
        position: 1,
      },
      // MYSCH-01's work-area view renders each assignment's checklist, so the
      // work areas the multi-day fixture below assigns on other stages need
      // their own todos rather than borrowing Day 1's.
      {
        workstation_id: finishLineDay2.id,
        instruction_text: 'Confirm timing gate is powered on',
        position: 0,
      },
      {
        workstation_id: waterStationDay3.id,
        instruction_text: 'Refill jugs before each wave',
        position: 0,
      },
    ])
    .select()
  if (todoError) throw todoError

  const todoFor = (workstationId: string, position: number) => {
    const found = todoRows.find(
      (row) => row.workstation_id === workstationId && row.position === position
    )
    if (!found) throw new Error(`Todo (workstation ${workstationId}, position ${position}) missing`)
    return found
  }

  const tenantAdminId = await upsertAuthUser(SEED_PHONES.tenantAdmin)
  const { error: adminRoleError } = await admin
    .from('user_roles')
    .insert({ user_id: tenantAdminId, tenant_id: tenant.id, role: 'tenant_admin' })
  if (adminRoleError) throw adminRoleError

  // F-MNT-20: an admin is always schedulable and appears on the roster as
  // implicitly Confirmed (Peter, 2026-06-24). Without this the seeded admin
  // has a user_roles row and no officials row — the exact shape of the bug —
  // so OFF-01 omits them, /{slug}/account 404s and SCHED-01's pool excludes
  // them. Delegated to the RPC rather than inserted here so the seed cannot
  // drift from the real rule (migration 20260911130436).
  const { error: adminRosterError } = await admin.rpc('ensure_admin_roster_row', {
    p_tenant_id: tenant.id,
    p_user_id: tenantAdminId,
  })
  if (adminRosterError) throw adminRosterError
  console.log(`  tenant_admin (also on the roster, schedulable): ${SEED_PHONES.tenantAdmin}`)

  // Three officials covering the invite_status states the app branches on
  // (see canViewOfficialSurfaces and the SEC-05 announcement filter bug).
  const confirmedUserId = await upsertAuthUser(SEED_PHONES.officialConfirmed)
  await admin
    .from('user_roles')
    .insert({ user_id: confirmedUserId, tenant_id: tenant.id, role: 'official' })

  const { data: confirmedOfficial, error: confirmedError } = await admin
    .from('officials')
    .insert({
      tenant_id: tenant.id,
      user_id: confirmedUserId,
      name: 'Seed Official Confirmed',
      phone: SEED_PHONES.officialConfirmed,
      invite_status: 'confirmed',
    })
    .select()
    .single()
  if (confirmedError) throw confirmedError
  console.log(`  official (confirmed, 3 days of shifts): ${SEED_PHONES.officialConfirmed}`)

  const { error: invitedError } = await admin.from('officials').insert({
    tenant_id: tenant.id,
    name: 'Seed Official Invited',
    phone: storedPhone(SEED_PHONES.officialInvited),
    invite_status: 'invited',
    invite_token_expires_at: inviteExpiresAt,
  })
  if (invitedError) throw invitedError
  console.log(`  official (invited, not yet confirmed): ${SEED_PHONES.officialInvited}`)

  const { error: removedError } = await admin.from('officials').insert({
    tenant_id: tenant.id,
    name: 'Seed Official Removed',
    phone: SEED_PHONES.officialRemoved,
    invite_status: 'removed',
  })
  if (removedError) throw removedError
  console.log(
    `  official (removed, tests the SEC-05 invite_status filter): ${SEED_PHONES.officialRemoved}`
  )

  // Two more confirmed officials, both loggable-in, for the MYSCH-01 cases the
  // three above cannot cover: one day of shifts renders no day selector at all
  // (DaySelector returns null below two days), and no shifts at all has to show
  // the empty-schedule copy rather than the empty-day copy.
  const singleDayOfficial = await createConfirmedOfficial(
    tenant.id,
    'Seed Official One Day',
    SEED_PHONES.officialSingleDay
  )
  console.log(`  official (confirmed, 1 day of shifts): ${SEED_PHONES.officialSingleDay}`)

  await createConfirmedOfficial(tenant.id, 'Seed Official No Shifts', SEED_PHONES.officialNoShifts)
  console.log(`  official (confirmed, no shifts at all): ${SEED_PHONES.officialNoShifts}`)

  const { error: participantError } = await admin.from('participants').insert({
    tenant_id: tenant.id,
    name: 'Seed Participant',
    phone: '+46709900010',
    bib: '101',
    category: 'Senior',
  })
  if (participantError) throw participantError

  // The MYSCH-01 day-window fixture. Each row earns its place:
  //   day0 Finish line + day0 Water station -> two work areas on one day, so the
  //                                            work-area view groups more than one
  //   day0 Finish line + day1 Finish line   -> the same work area *name* on two
  //                                            days, the case whose flattened
  //                                            date row was removed from the
  //                                            work-area view. These are now two
  //                                            rows (one per stage) rather than
  //                                            one shared row, since a work area
  //                                            belongs to a single stage.
  //   day2 Water station at 13:00           -> a shift no other day has, so the
  //                                            window is seen to exclude rather
  //                                            than merely order
  //   singleDayOfficial on day0 only        -> the no-day-selector case
  // All rows are distinct on (workstation_id, timeslot_start, slot_index), so
  // 0012's unique index needs no special handling, and every row carries a
  // workstation_id, which is what 0003's status='assigned' check requires.
  const { error: assignmentError } = await admin.from('assignments').insert([
    {
      tenant_id: tenant.id,
      official_id: confirmedOfficial.id,
      workstation_id: finishLineDay1.id,
      todo_id: todoFor(finishLineDay1.id, 0).id,
      timeslot_start: at(day0, '08:00'),
      timeslot_end: at(day0, '09:00'),
      slot_index: 1,
      status: 'assigned',
    },
    {
      tenant_id: tenant.id,
      official_id: confirmedOfficial.id,
      workstation_id: waterStationDay1.id,
      todo_id: todoFor(waterStationDay1.id, 0).id,
      timeslot_start: at(day0, '10:00'),
      timeslot_end: at(day0, '11:00'),
      slot_index: 1,
      status: 'assigned',
    },
    {
      tenant_id: tenant.id,
      official_id: confirmedOfficial.id,
      workstation_id: finishLineDay2.id,
      todo_id: todoFor(finishLineDay2.id, 0).id,
      timeslot_start: at(day1, '08:00'),
      timeslot_end: at(day1, '09:00'),
      slot_index: 1,
      status: 'assigned',
    },
    {
      tenant_id: tenant.id,
      official_id: confirmedOfficial.id,
      workstation_id: waterStationDay3.id,
      todo_id: todoFor(waterStationDay3.id, 0).id,
      timeslot_start: at(day2, '13:00'),
      timeslot_end: at(day2, '14:00'),
      slot_index: 1,
      status: 'assigned',
    },
    {
      tenant_id: tenant.id,
      official_id: singleDayOfficial.id,
      workstation_id: finishLineDay1.id,
      todo_id: todoFor(finishLineDay1.id, 0).id,
      timeslot_start: at(day0, '08:00'),
      timeslot_end: at(day0, '09:00'),
      slot_index: 2,
      status: 'assigned',
    },
  ])
  if (assignmentError) throw assignmentError
  console.log(
    `  assignments: 4 for ${SEED_PHONES.officialConfirmed} across ${day0}/${day1}/${day2}`
  )
  console.log(`               1 for ${SEED_PHONES.officialSingleDay} on ${day0}`)

  const { error: announcementError } = await admin.from('announcements').insert({
    tenant_id: tenant.id,
    channel: 'officials',
    body: 'Welcome to Seed Race 2026 — briefing at 07:30.',
    sms_sent: false,
    published_at: new Date(0).toISOString(),
  })
  if (announcementError) throw announcementError

  console.log('\nDone. Log in with any seed phone number above using the dev OTP flow.')
  console.log(`Tenant slug: ${slug}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
