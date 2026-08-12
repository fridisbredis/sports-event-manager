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
// GoTrue container persists users across test runs, so each number must be
// freed up before reuse rather than minted fresh.
const TEST_PHONES = ['+46700000001', '+46700000002', '+46700000003']
let phoneIndex = 0

async function claimTestPhone(admin: ReturnType<typeof serviceClient>) {
  const phone = TEST_PHONES[phoneIndex % TEST_PHONES.length]
  phoneIndex += 1

  const { data: existing } = await admin.auth.admin.listUsers()
  const existingUser = existing?.users.find((u) => u.phone === phone.replace('+', ''))
  if (existingUser) {
    await admin.auth.admin.deleteUser(existingUser.id)
  }
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

  const existing = createdUserIdsByTenant.get(tenantId) ?? []
  existing.push(userData.user.id)
  createdUserIdsByTenant.set(tenantId, existing)

  return { userId: userData.user.id, phone }
}

// Logs in as the given phone via the local test OTP (see supabase/config.toml
// [auth.sms.test_otp]) and returns an anon-key client carrying that user's
// real session — this is the client RLS actually sees.
export async function signInAsClient(phone: string, otp: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error } = await client.auth.verifyOtp({ phone, token: otp, type: 'sms' })
  if (error) throw error
  return client
}

export async function cleanupTenant(tenantId: string) {
  const admin = serviceClient()
  await admin.from('tenants').delete().eq('id', tenantId)

  const userIds = createdUserIdsByTenant.get(tenantId) ?? []
  createdUserIdsByTenant.delete(tenantId)
  await Promise.all(userIds.map((id) => admin.auth.admin.deleteUser(id)))
}
