import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { TenantRole } from '@/lib/auth/tenant'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export function serviceClient(): SupabaseClient<Database> {
  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function createTenant(name: string) {
  const admin = serviceClient()
  const slug = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const { data, error } = await admin
    .from('tenants')
    .insert({ name, slug, is_active: true })
    .select()
    .single()
  if (error) throw error
  return data
}

// Fixed numbers from supabase/config.toml [auth.sms.test_otp] — the local
// GoTrue container persists users across test runs. Test files can run in
// the same worker process (module state survives across files even with
// fileParallelism: false), so a blind round-robin index would eventually
// reclaim a number still held by another file's still-signed-in client.
// Instead, always pick a number with no existing user, only falling back to
// deleting the oldest-claimed one if every number is genuinely in use at
// once — the pool must stay larger than the max number of distinct users
// alive at the same time across the whole suite.
const TEST_PHONES = [
  '+46700000001',
  '+46700000002',
  '+46700000003',
  '+46700000004',
  '+46700000005',
  '+46700000006',
  '+46700000007',
  '+46700000008',
  '+46700000009',
  '+46700000010',
]
const claimedOrder: string[] = []

async function claimTestPhone(admin: ReturnType<typeof serviceClient>) {
  const { data: existing } = await admin.auth.admin.listUsers()
  const takenPhones = new Set(existing?.users.map((u) => u.phone).filter(Boolean))

  let phone = TEST_PHONES.find((candidate) => !takenPhones.has(candidate.replace('+', '')))

  if (!phone) {
    const oldest = claimedOrder.shift()
    if (!oldest) throw new Error('No free test phone number and no claimed number to evict')
    const staleUser = existing?.users.find((u) => u.phone === oldest.replace('+', ''))
    if (staleUser) await admin.auth.admin.deleteUser(staleUser.id)
    phone = oldest
  }

  claimedOrder.push(phone)
  return phone
}

const createdUserIdsByTenant = new Map<string, string[]>()

export async function createUserWithRole(tenantId: string, role: TenantRole) {
  const admin = serviceClient()
  const phone = await claimTestPhone(admin)

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
  })
  if (userError) throw userError

  const { error: roleError } = await admin
    .from('user_roles')
    .insert({ user_id: userData.user.id, tenant_id: tenantId, role })
  if (roleError) throw roleError

  // canViewOfficialSurfaces additionally requires a confirmed `officials` row
  // for the 'official' role — a user_roles row alone is not enough (see
  // src/lib/auth/tenant.ts). Without this, every 'official' fixture created
  // here would be denied access as if still invited.
  if (role === 'official') {
    const { error: officialError } = await admin.from('officials').insert({
      tenant_id: tenantId,
      user_id: userData.user.id,
      name: 'Test Official',
      phone: `+46701${Math.floor(Math.random() * 1_000_000)}`,
      invite_status: 'confirmed',
    })
    if (officialError) throw officialError
  }

  const existing = createdUserIdsByTenant.get(tenantId) ?? []
  existing.push(userData.user.id)
  createdUserIdsByTenant.set(tenantId, existing)

  return { userId: userData.user.id, phone }
}

// system_admin is a global role: migration 0021 made user_roles.tenant_id
// nullable and added a CHECK requiring it to be NULL for system_admin and
// NOT NULL for every other role. createUserWithRole() always writes a
// tenant_id, so it cannot create one — hence this separate function.
// Cleanup is the caller's job via deleteAuthUser(), since cleanupTenant()
// keys its user list by tenant and a system_admin belongs to none.
export async function createSystemAdmin() {
  const admin = serviceClient()
  const phone = await claimTestPhone(admin)

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
  })
  if (userError) throw userError

  const { error: roleError } = await admin
    .from('user_roles')
    .insert({ user_id: userData.user.id, tenant_id: null, role: 'system_admin' })
  if (roleError) throw roleError

  return { userId: userData.user.id, phone }
}

// Frees the test phone the user holds. Only needed for users created outside
// createUserWithRole() — cleanupTenant() already deletes the ones it tracks.
export async function deleteAuthUser(userId: string) {
  const admin = serviceClient()
  await admin.from('user_roles').delete().eq('user_id', userId)
  await admin.auth.admin.deleteUser(userId)
}

// Logs in as the given phone via the local test OTP (see supabase/config.toml
// [auth.sms.test_otp]) and returns an anon-key client carrying that user's
// real session — this is the client RLS actually sees.
export async function signInAsClient(
  phone: string,
  otp: string
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error } = await client.auth.verifyOtp({ phone, token: otp, type: 'sms' })
  if (error) throw error
  return client
}

// Creates an `officials` row linked to the given auth user's id, so RLS
// policies keyed on `officials.user_id = auth.uid()` (e.g.
// official_read_own_assignments) resolve to this official.
export async function createOfficialLinkedToUser(
  tenantId: string,
  userId: string,
  name: string,
  inviteStatus: 'invited' | 'confirmed' | 'removed' = 'confirmed'
) {
  const admin = serviceClient()
  const { data, error } = await admin
    .from('officials')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      name,
      phone: `+46701${Math.floor(Math.random() * 1_000_000)}`,
      invite_status: inviteStatus,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

// Creates a `participants` row linked to the given auth user's id, so
// `participant_read_own` (user_id = auth.uid()) resolves to this participant.
export async function createParticipantLinkedToUser(
  tenantId: string,
  userId: string,
  name: string
) {
  const admin = serviceClient()
  const { data, error } = await admin
    .from('participants')
    .insert({
      tenant_id: tenantId,
      user_id: userId,
      name,
      phone: `+46702${Math.floor(Math.random() * 1_000_000)}`,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function cleanupTenant(tenantId: string) {
  const admin = serviceClient()
  await admin.from('tenants').delete().eq('id', tenantId)

  const userIds = createdUserIdsByTenant.get(tenantId) ?? []
  createdUserIdsByTenant.delete(tenantId)
  await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)))
}
