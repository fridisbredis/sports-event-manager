import type { SupabaseClient } from '@supabase/supabase-js'
import type twilio from 'twilio'
import type { Database } from '@/types/database'
import { logger } from '@/lib/logger'
import { logQueryError } from '@/lib/db/query-error'
import { toTwilioE164 } from '@/lib/phone'
import { readAllTenantSmsUsage } from './cap'
import { SMS_COST_CURRENCY, startOfMonthUtc } from './cost'
import { parseSegments } from './usage'

/**
 * The 90% warning before a tenant hits its monthly SMS cap (N32).
 *
 * N24 stops a tenant's SMS at 100% of its tier's cap and shows the spend in
 * EVT-01 and SYS-01/02, but texted nobody. Peter's rules (2026-10-29):
 *
 *   1. at 90% of the tenant's monthly cap,
 *   2. to every tenant admin of that tenant AND every system admin,
 *   3. once per tenant and calendar month,
 *   4. never stopped by the cap,
 *   5. never counted toward the tenant's SMS cost,
 *   6. regardless of sms_opt_out,
 *   7. on every tier that has a cap,
 *   8. in English, like the other system SMS.
 *
 * WHERE IT RUNS
 *
 * From the SMS worker, once per tick (every minute), rather than from each of
 * the five paths that add to a tenant's spend. One place sees every path —
 * invites, resends, availability confirmations and GDPR warnings all count,
 * not only the announcements the worker itself sends — and a new sender added
 * later is covered without anyone remembering this. The cost is up to a
 * minute's delay, which does not matter for a warning about a monthly total.
 * A separate cron job would have meant a new pg_cron schedule and Vault
 * secret on both environments for the same result.
 *
 * Cheap on a quiet tick: tenants already warned this month are filtered out
 * before any usage is read, so once every tenant near its cap has been
 * warned, the tick is two small reads.
 *
 * HOW THE RULES MAP TO CODE
 *
 *   4. No cap check anywhere in here.
 *   5. Not written to sms_usage, which is exactly what the cap sums. The
 *      segments go on the sms_cap_warnings row instead, for reconciling the
 *      Twilio invoice.
 *   6. Recipients come from user_roles and auth.users, never from officials,
 *      so sms_opt_out is never read.
 *   3. sms_cap_warnings has (tenant_id, month) as primary key. The row is
 *      inserted BEFORE sending, and only the insert that succeeds sends —
 *      two overlapping ticks cannot both text the admins.
 *
 * Sent from the platform number, not the tenant's N13 sender name: system
 * admins receive this for every tenant, and the body names the tenant.
 */

/** The share of the monthly cap at which admins are warned. */
export const CAP_WARNING_THRESHOLD = 0.9

const OP = 'POST /api/cron/sms-worker (cap warning)'

// A trip-wire, not a limit: today's numbers are three system admins and at
// most ten tenant admins per tenant. Each recipient costs one auth lookup.
const RECIPIENT_CEILING = 100

type TwilioClient = ReturnType<typeof twilio>

export function isAtWarningThreshold(spentAmount: number, capAmount: number): boolean {
  // A cap of zero or less is no cap (rule 7) — and would otherwise make every
  // tenant "over 90%" of nothing on every tick.
  return capAmount > 0 && spentAmount >= capAmount * CAP_WARNING_THRESHOLD
}

/**
 * The warning text. ASCII only, so it stays GSM-7 (160 characters per
 * segment) — an en dash or curly quote would force UCS-2 and halve that; see
 * cost.ts. Amounts are whole kronor: öre in an SMS is noise.
 */
export function capWarningBody({
  tenantName,
  spentAmount,
  capAmount,
}: {
  tenantName: string
  spentAmount: number
  capAmount: number
}): string {
  const percent = Math.floor((spentAmount / capAmount) * 100)
  return (
    `Sports Event Manager: ${tenantName} has used ${percent}% of its monthly SMS limit ` +
    `(${Math.round(spentAmount)} of ${capAmount} ${SMS_COST_CURRENCY}). ` +
    `At 100%, announcements and invites stop until next month.`
  )
}

interface SendArgs {
  service: SupabaseClient<Database>
  client: TwilioClient
  /** The platform number, TWILIO_PHONE_NUMBER. */
  fromNumber: string
  now?: Date
}

/**
 * Warns every tenant at or past 90% of its cap that has not been warned this
 * month. Never throws: it runs inside the SMS worker, and a warning that
 * cannot go out must not turn the tick that sends announcements into a 500.
 *
 * Returns how many tenants were warned, for the worker's response.
 */
export async function sendSmsCapWarnings(args: SendArgs): Promise<number> {
  try {
    return await sendWarnings(args)
  } catch (err) {
    logger.error('SMS cap warning run failed', err)
    return 0
  }
}

async function sendWarnings({ service, client, fromNumber, now }: SendArgs): Promise<number> {
  const month = startOfMonthUtc(now).slice(0, 10)

  const { data: warnedRows, error: warnedError } = await service
    .from('sms_cap_warnings')
    .select('tenant_id')
    .eq('month', month)

  // Stop rather than guess. The primary key would still prevent a second
  // warning, but reading every tenant's usage to then fail on the insert is
  // work for nothing, and the next tick tries again.
  if (warnedError) {
    logQueryError(warnedError, {
      op: OP,
      table: 'sms_cap_warnings',
      kind: 'select',
      extra: { consequence: 'cap_warnings_skipped_this_tick' },
    })
    return 0
  }

  const warned = new Set((warnedRows ?? []).map((row) => row.tenant_id))

  const { data: tenantRows, error: tenantsError } = await service
    .from('tenants')
    .select('id, name, tier')

  if (tenantsError) {
    logQueryError(tenantsError, {
      op: OP,
      table: 'tenants',
      kind: 'select',
      extra: { consequence: 'cap_warnings_skipped_this_tick' },
    })
    return 0
  }

  const candidates = (tenantRows ?? []).filter((tenant) => !warned.has(tenant.id))
  if (candidates.length === 0) return 0

  const usage = await readAllTenantSmsUsage({ service, tenants: candidates, op: OP })
  if (!usage) return 0

  const due = usage.filter((tenant) => isAtWarningThreshold(tenant.spentAmount, tenant.capAmount))

  let warnedCount = 0

  // Sequential, not parallel: a handful of tenants at most cross 90% in the
  // same minute, and one at a time keeps the auth lookups and Twilio calls
  // from bunching up.
  for (const tenant of due) {
    if (await warnTenant({ service, client, fromNumber, month, tenant })) warnedCount += 1
  }

  return warnedCount
}

interface WarnTenantArgs {
  service: SupabaseClient<Database>
  client: TwilioClient
  fromNumber: string
  month: string
  tenant: { tenantId: string; tenantName: string; spentAmount: number; capAmount: number }
}

async function warnTenant({
  service,
  client,
  fromNumber,
  month,
  tenant,
}: WarnTenantArgs): Promise<boolean> {
  const { tenantId } = tenant

  // The claim. Only the tick whose insert succeeds goes on to send.
  const { error: claimError } = await service
    .from('sms_cap_warnings')
    .insert({ tenant_id: tenantId, month })

  if (claimError) {
    // 23505: another tick claimed it between our read and this insert. It is
    // sending the warning; nothing to do.
    if (claimError.code !== '23505') {
      logQueryError(claimError, {
        op: OP,
        table: 'sms_cap_warnings',
        kind: 'insert',
        tenantId,
        extra: { consequence: 'cap_warning_not_sent_retry_next_tick' },
      })
    }
    return false
  }

  const phones = await readRecipientPhones(service, tenantId)

  const body = capWarningBody(tenant)
  let sent = 0
  let failed = 0
  let segments = 0

  for (const phone of phones) {
    try {
      const message = await client.messages.create({
        body,
        from: fromNumber,
        to: toTwilioE164(phone),
      })
      sent += 1
      segments += parseSegments(message?.numSegments)
    } catch (err) {
      failed += 1
      // Twilio's numeric code only — the raw error can echo the number.
      const code = (err as { code?: unknown } | null)?.code
      logger.error('SMS cap warning send failed', undefined, {
        tenantId,
        twilioCode: code ?? 'none',
      })
    }
  }

  // Every send failed — most likely Twilio is down. Release the claim so the
  // next tick tries again, rather than the month passing with nobody told.
  // Not when there was nobody to send to: retrying that every minute would
  // change nothing, and the error below already says so.
  if (phones.length > 0 && sent === 0) {
    const { error: releaseError } = await service
      .from('sms_cap_warnings')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('month', month)

    if (releaseError) {
      logQueryError(releaseError, {
        op: OP,
        table: 'sms_cap_warnings',
        kind: 'delete',
        tenantId,
        extra: { consequence: 'cap_warning_lost_for_this_month' },
      })
    }
    return false
  }

  if (phones.length === 0) {
    logger.error('SMS cap warning had no recipients with a phone number', undefined, { tenantId })
  }

  const { error: recordError } = await service
    .from('sms_cap_warnings')
    .update({ sent_count: sent, failed_count: failed, segments })
    .eq('tenant_id', tenantId)
    .eq('month', month)

  // The warning went out and the claim stands, so nothing is resent. Only the
  // reconciliation figures are missing.
  if (recordError) {
    logQueryError(recordError, {
      op: OP,
      table: 'sms_cap_warnings',
      kind: 'update',
      tenantId,
      extra: { consequence: 'cap_warning_counts_not_recorded' },
    })
  }

  logger.info(
    `SMS cap warning sent (N32): tenant=${tenantId} spent=${tenant.spentAmount} ` +
      `cap=${tenant.capAmount} sent=${sent} failed=${failed}`
  )

  return sent > 0
}

/**
 * The phone numbers of this tenant's admins and of every system admin, one
 * per person.
 *
 * Read from user_roles and auth.users — the number each admin logs in with —
 * not from the officials roster. That keeps sms_opt_out out of it (rule 6:
 * the warning goes to admins who opted out of SMS), and reaches system
 * admins, who have no roster row at all.
 */
async function readRecipientPhones(
  service: SupabaseClient<Database>,
  tenantId: string
): Promise<string[]> {
  const { data: roleRows, error: rolesError } = await service
    .from('user_roles')
    .select('user_id')
    .or(`role.eq.system_admin,and(role.eq.tenant_admin,tenant_id.eq.${tenantId})`)
    .range(0, RECIPIENT_CEILING - 1)

  if (rolesError) {
    logQueryError(rolesError, {
      op: OP,
      table: 'user_roles',
      kind: 'select',
      tenantId,
      extra: { consequence: 'cap_warning_no_recipients' },
    })
    return []
  }

  // One person can hold several of these rows — a system admin who is also
  // this tenant's admin, or several system_admin rows (migration
  // 20261026134923) — and must get one SMS, not one per row.
  const userIds = [...new Set((roleRows ?? []).map((row) => row.user_id))]

  const phones = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await service.auth.admin.getUserById(userId)
      if (error) {
        logger.error('SMS cap warning: admin auth lookup failed', error, { tenantId, userId })
        return null
      }
      return data.user?.phone || null
    })
  )

  return [...new Set(phones.filter((phone): phone is string => phone !== null))]
}
