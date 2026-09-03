// Seeds the dev Supabase project with a realistic tenant for manual testing.
//
// Usage: npm run seed:dev
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
const SEED_PHONES = {
  tenantAdmin: '+46709900001',
  officialConfirmed: '+46709900002',
  officialInvited: '+46709900003',
  officialRemoved: '+46709900004',
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

async function upsertAuthUser(phone: string) {
  const { data: existing } = await admin.auth.admin.listUsers()
  const found = existing.users.find((u) => u.phone === phone.replace('+', ''))
  if (found) return found.id

  const { data, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true })
  if (error) throw error
  return data.user.id
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
      start_date: '2026-09-05',
      end_date: '2026-09-06',
      location: 'Seed Stadium',
      status: 'published',
      scheduling_granularity_min: 60,
    })
    .select()
    .single()
  if (eventError) throw eventError
  console.log(`  event: ${event.name} (${event.id})`)

  const { error: stageError } = await admin
    .from('event_stages')
    .insert({
      tenant_id: tenant.id,
      event_id: event.id,
      name: 'Day 1',
      stage_date: '2026-09-05',
      venue: 'Seed Stadium',
      position: 0,
    })
    .select()
    .single()
  if (stageError) throw stageError

  const { data: workstation, error: wsError } = await admin
    .from('workstations')
    .insert({
      tenant_id: tenant.id,
      event_id: event.id,
      name: 'Finish line',
      description: 'Timing and finish chute',
      capacity_ceiling: 4,
    })
    .select()
    .single()
  if (wsError) throw wsError

  const { error: windowError } = await admin.from('workstation_operating_windows').insert({
    workstation_id: workstation.id,
    window_start: '2026-09-05T07:00:00Z',
    window_end: '2026-09-05T18:00:00Z',
  })
  if (windowError) throw windowError

  const { data: todo, error: todoError } = await admin
    .from('workstation_todos')
    .insert({
      workstation_id: workstation.id,
      instruction_text: 'Confirm timing gate is powered on',
      position: 0,
    })
    .select()
    .single()
  if (todoError) throw todoError

  const tenantAdminId = await upsertAuthUser(SEED_PHONES.tenantAdmin)
  const { error: adminRoleError } = await admin
    .from('user_roles')
    .insert({ user_id: tenantAdminId, tenant_id: tenant.id, role: 'tenant_admin' })
  if (adminRoleError) throw adminRoleError
  console.log(`  tenant_admin: ${SEED_PHONES.tenantAdmin}`)

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
  console.log(`  official (confirmed): ${SEED_PHONES.officialConfirmed}`)

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

  const { error: participantError } = await admin.from('participants').insert({
    tenant_id: tenant.id,
    name: 'Seed Participant',
    phone: '+46709900010',
    bib: '101',
    category: 'Senior',
  })
  if (participantError) throw participantError

  const { error: assignmentError } = await admin.from('assignments').insert({
    tenant_id: tenant.id,
    official_id: confirmedOfficial.id,
    workstation_id: workstation.id,
    todo_id: todo.id,
    timeslot_start: '2026-09-05T08:00:00Z',
    timeslot_end: '2026-09-05T09:00:00Z',
    slot_index: 1,
    status: 'assigned',
  })
  if (assignmentError) throw assignmentError

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
