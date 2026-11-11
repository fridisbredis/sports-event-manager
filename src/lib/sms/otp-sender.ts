/**
 * B14 — which sender a one-time code goes out from.
 *
 * N13 gave tenant SMS an alphanumeric sender ("Viadal"), but the login code
 * stayed on the platform number because GoTrue sent it. The Send SMS hook
 * (api/auth/send-sms-hook) now sends it, and this decides the sender.
 *
 * The hook only knows the user and the phone, not a tenant — /login is
 * global. So the tenant is inferred from who the number belongs to:
 *
 *   - user_roles rows for the user (admins, confirmed officials, participants)
 *   - officials rows on the number (an invitee who has not confirmed yet has
 *     no role, but the invite page is exactly where the code matters most)
 *
 * The name is used only when every tenant found resolves to the SAME sender.
 * A number in two tenants, or in one with a name and one without, gets the
 * platform number: a code from "Viadal" to someone logging in for another
 * club would be wrong in a way the platform number never is. No tenant at
 * all (a system admin, a first-time claimer) also means the platform number.
 *
 * Every lookup failure falls back to the platform number. The sender is
 * cosmetic; the code reaching the phone is not — if this throws, nobody can
 * log in.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { stripE164Plus } from '@/lib/phone'
import { logQueryError } from '@/lib/db/query-error'
import { resolveSmsSender } from './sender'

const OP = 'POST /api/auth/send-sms-hook'

export interface OtpSender {
  /** The Twilio `from`: a tenant's alphanumeric name or the platform number. */
  from: string
  /** The tenant's display name for the message body, when `from` is its name. */
  tenantName: string | null
}

export async function resolveOtpSender(
  service: SupabaseClient<Database>,
  user: { id: string; phone: string },
  platformSender: string
): Promise<OtpSender> {
  const platform: OtpSender = { from: platformSender, tenantName: null }

  const stripped = stripE164Plus(user.phone)
  // Stored phones are E.164 but legacy rows are inconsistent about the '+'
  // (see src/lib/phone.ts), so match both shapes.
  const phoneShapes = [stripped, `+${stripped}`]

  const [roles, officials] = await Promise.all([
    service.from('user_roles').select('tenant_id').eq('user_id', user.id),
    service.from('officials').select('tenant_id').in('phone', phoneShapes),
  ])

  if (roles.error) {
    logQueryError(roles.error, { op: OP, table: 'user_roles', kind: 'select' })
  }
  if (officials.error) {
    logQueryError(officials.error, { op: OP, table: 'officials', kind: 'select' })
  }
  // A half-answered lookup could hide the second tenant that should have
  // forced the platform number, so either failure means platform.
  if (roles.error || officials.error) return platform

  const tenantIds = new Set<string>()
  for (const row of roles.data ?? []) if (row.tenant_id) tenantIds.add(row.tenant_id)
  for (const row of officials.data ?? []) tenantIds.add(row.tenant_id)
  if (tenantIds.size === 0) return platform

  const tenants = await service
    .from('tenants')
    .select('id, name, tier, sms_sender_id')
    .in('id', [...tenantIds])

  if (tenants.error) {
    logQueryError(tenants.error, { op: OP, table: 'tenants', kind: 'select' })
    return platform
  }
  // A tenant id that did not come back is a tenant we cannot vouch for.
  if (!tenants.data || tenants.data.length !== tenantIds.size) return platform

  const senders = new Set(tenants.data.map((t) => resolveSmsSender(t, platformSender)))
  if (senders.size !== 1) return platform

  const [from] = senders
  if (from === platformSender) return platform

  // Several tenants sharing one sender name is allowed (one club, two
  // tenants). Their display names may differ, so the body then uses the
  // sender name they share rather than picking one of them.
  return { from, tenantName: tenants.data.length === 1 ? tenants.data[0].name : from }
}
