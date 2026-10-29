import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import type { Database } from '../../../src/types/database'
import { SEED_TENANT_SLUG } from './users'

// Numbers reserved for AUTH-02 in supabase/config.toml [auth.sms.test_otp].
// Deliberately disjoint from USERS (+4670990000x, seeded *with* roles) and from
// the integration pool (+4670000000x): this spec must sign in as someone who
// holds no role yet, because the behaviour under test is a user *becoming* an
// official. Reusing a seeded number would skip the state being asserted.
//
// One number per test rather than one shared number, so a failure mid-run
// cannot leave a half-confirmed user that the next test then signs in as.
export const INVITE_PHONES = {
  tokenLink: '+46709910001',
  phoneFallback: '+46709910002',
  multiTenant: '+46709910003',
  expired: '+46709910004',
} as const

export type InvitePhone = (typeof INVITE_PHONES)[keyof typeof INVITE_PHONES]

// INVITE_PHONES carry the '+' because that is what the UI and GoTrue expect on
// the way in; storage drops it. Keeping the conversion in one place stops the
// two shapes drifting apart across seed, read and cleanup.
function stripPlus(phone: string): string {
  return phone.startsWith('+') ? phone.slice(1) : phone
}

export function serviceClient(): SupabaseClient<Database> {
  const url = process.env.E2E_SUPABASE_URL
  const key = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'E2E_SUPABASE_URL / E2E_SUPABASE_SERVICE_ROLE_KEY are unset — globalSetup did not run.'
    )
  }
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function tenantIdBySlug(admin: SupabaseClient<Database>, slug: string) {
  const { data, error } = await admin.from('tenants').select('id').eq('slug', slug).single()
  if (error) throw error
  return data.id
}

// A second tenant, for the multi-tenant picker. Created on demand rather than
// seeded: only this spec needs it, and seed-dev.ts deliberately builds exactly
// one tenant so OFF-01's counts stay predictable.
export const SECOND_TENANT_SLUG = 'e2e-invite-klubben'

export async function ensureSecondTenant(admin: SupabaseClient<Database>) {
  const tenantId = await ensureSecondTenantRow(admin)
  await ensureSecondTenantEvent(admin, tenantId)
  return tenantId
}

// N23: an official sees only the events they are a member of, so a tenant
// with no event leaves its officials on an empty event picker. Real tenants
// always have one (create_tenant_with_defaults); this gives the fixture one
// too, and puts its officials in it — including any created by an earlier
// run against a local stack that predates this, before the event existed.
async function ensureSecondTenantEvent(admin: SupabaseClient<Database>, tenantId: string) {
  const { data: events, error: readError } = await admin
    .from('events')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)
  if (readError) throw readError

  let eventId = events?.[0]?.id
  if (!eventId) {
    const { data, error } = await admin
      .from('events')
      .insert({ tenant_id: tenantId, name: 'E2E Invite Event', event_type: 'race' })
      .select('id')
      .single()
    if (error) throw error
    eventId = data.id
  }

  const { data: officials, error: officialsError } = await admin
    .from('officials')
    .select('id')
    .eq('tenant_id', tenantId)
  if (officialsError) throw officialsError
  if (officials && officials.length > 0) {
    const { error } = await admin.from('official_events').upsert(
      officials.map((o) => ({ official_id: o.id, event_id: eventId, tenant_id: tenantId })),
      { onConflict: 'official_id,event_id', ignoreDuplicates: true }
    )
    if (error) throw error
  }
}

async function ensureSecondTenantRow(admin: SupabaseClient<Database>) {
  const { data: existing, error: readError } = await admin
    .from('tenants')
    .select('id')
    .eq('slug', SECOND_TENANT_SLUG)
    .maybeSingle()
  if (readError) throw readError
  if (existing) return existing.id

  const { data, error } = await admin
    .from('tenants')
    .insert({
      name: 'E2E Invite Klubben',
      slug: SECOND_TENANT_SLUG,
      is_active: true,
      // 'professional' (N20 admin cap 10), not 'standard' (cap 1): this tenant
      // exists to exercise invite and multi-tenant flows, and those seed more
      // than one admin into it. On 'standard' the later ones are correctly
      // locked out by the cap and the specs fail for a reason unrelated to
      // what they test.
      tier: 'professional',
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}

export interface SeededInvite {
  officialId: string
  tenantId: string
  token: string
}

interface SeedOptions {
  /** Defaults to the seed tenant. */
  tenantId?: string
  name?: string
  /** Past expiry produces the "invite expired" states. Defaults to +7 days. */
  expiresAt?: Date
}

// Puts a single 'invited' official row in place for `phone`, replacing whatever
// an earlier run left behind. Returns the token so the spec can visit the exact
// link the invite SMS would carry.
export async function seedInvite(
  admin: SupabaseClient<Database>,
  phone: string,
  options: SeedOptions = {}
): Promise<SeededInvite> {
  const tenantId = options.tenantId ?? (await tenantIdBySlug(admin, SEED_TENANT_SLUG))
  const token = randomUUID()
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

  // Stored in the app's canonical shape: E.164 *without* the leading '+'.
  // That is what normalizePhoneToE164 writes and, critically, what Supabase
  // Auth puts in user.phone — and the phone-fallback path matches the two with
  // exact string equality (getPendingOfficialInvitesByPhone, and the SEC-04
  // RPCs 0017/0018). Seeding a '+'-prefixed row makes that match silently miss,
  // so the invitee lands on "not authorized" instead of the consent screen.
  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      phone: stripPlus(phone),
      name: options.name ?? 'E2E Invitee',
      invite_status: 'invited',
      invite_token: token,
      invite_token_expires_at: expiresAt.toISOString(),
    })
    .select('id')
    .single()
  if (error) throw error

  // N23: an invite is always into one event (create_official_in_event), and
  // an official sees only the events they are in. officials_join_sole_event
  // only covers a tenant with exactly one active event, so join the oldest
  // active one explicitly — what OFF-01 would have done.
  const { data: event, error: eventError } = await admin
    .from('events')
    .select('id')
    .eq('tenant_id', tenantId)
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (eventError) throw eventError
  if (event) {
    const { error: memberError } = await admin
      .from('official_events')
      .upsert(
        { official_id: data.id, event_id: event.id, tenant_id: tenantId },
        { onConflict: 'official_id,event_id', ignoreDuplicates: true }
      )
    if (memberError) throw memberError
  }

  return { officialId: data.id, tenantId, token }
}

// Removes every trace of a test invitee: officials rows, role grants, and the
// auth user GoTrue created on first OTP verify. Without the auth-user delete a
// second run would sign in as an already-confirmed user and never see the
// invite screen at all.
export async function resetInvitee(admin: SupabaseClient<Database>, phone: string) {
  const stored = phone.replace(/^\+/, '')

  let userId: string | undefined
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error
    const found = data.users.find((u) => u.phone === stored)
    if (found) {
      userId = found.id
      break
    }
    if (data.users.length < 1000) break
  }

  if (userId) {
    // Roles first: user_roles.user_id references auth.users, and deleting the
    // user with rows still pointing at it fails on stacks where that FK is
    // not ON DELETE CASCADE.
    const { error: roleError } = await admin.from('user_roles').delete().eq('user_id', userId)
    if (roleError) throw roleError

    const { error: prefError } = await admin.from('user_preferences').delete().eq('user_id', userId)
    if (prefError) throw prefError
  }

  const { error: officialError } = await admin
    .from('officials')
    .delete()
    .eq('phone', stripPlus(phone))
  if (officialError) throw officialError

  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw error
  }
}

// Reads back the row the flow was supposed to write, for the post-confirm
// assertions. Returns null when no officials row exists for the phone.
export async function readOfficialByPhone(
  admin: SupabaseClient<Database>,
  phone: string,
  tenantId?: string
) {
  let query = admin
    .from('officials')
    .select('id, name, invite_status, invite_token, privacy_accepted_at, user_id, tenant_id')
    .eq('phone', stripPlus(phone))
  if (tenantId) query = query.eq('tenant_id', tenantId)

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  return data
}
