import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'
import { monthlySmsCapSek } from '@/lib/tiers/features'
import { isUsingFallbackRate, startOfMonthUtc, totalUsage } from './cost'

/**
 * Enforcing the per-tenant monthly SMS spending cap (N24).
 *
 * N11 measures; this stops. One cap, in SEK, per calendar month, per tenant,
 * set by the tenant's tier in `MONTHLY_SMS_CAP_SEK`.
 *
 * WHAT IS AND IS NOT STOPPED
 *
 * Stopped: announcements and invites — traffic a tenant chooses to generate,
 * where "you have reached your limit" is a sentence an admin can act on.
 *
 * Never stopped: login OTP. Blocking it locks everyone out of the app,
 * including the admin who needs to get in to see the warning and do something
 * about it. That decision is also forced by where OTP comes from: Supabase
 * Auth sends it through its own Twilio credentials and we never see the call,
 * so it is neither counted nor blockable here. The practical consequence is
 * that a tenant's measured spend is always an UNDERCOUNT of its real Twilio
 * bill, and the cap is therefore slightly generous rather than slightly
 * strict. That is the right direction for the error to point.
 *
 * Never stopped: the GDPR inactivity warning. It is a legal obligation under
 * the retention decision (SEC-09/F-SEC-10), sent once per person before their
 * data is anonymised. A spending limit must not cause us to silently skip a
 * notice someone is entitled to receive — the cost is a handful of messages a
 * month and the alternative is a compliance failure to save small change.
 *
 * FAIL OPEN, DELIBERATELY
 *
 * If the usage query fails, sending proceeds. A tenant that cannot be measured
 * is not a tenant that should go silent: the failure mode of blocking on a
 * database error is an event where nobody can reach the officials, and that is
 * far worse than overshooting a provisional cap by one batch. The error is
 * logged so the gap is visible rather than silent (F-REL-10).
 */

/** Message kinds the cap applies to. */
export type CappedSmsKind = 'invite' | 'invite_resend' | 'announcement'

export interface SmsCapStatus {
  /** SEK spent this calendar month, derived from recorded segments. */
  spentSek: number
  /**
   * Billable segments behind spentSek. The kronor are derived from this, so
   * anyone checking a figure against a Twilio invoice needs the segments
   * rather than the conversion — totalUsage already counts them, and
   * discarding them here would mean a second query to get them back.
   */
  segments: number
  /** Messages Twilio refused. They cost nothing, but a tenant generating
   *  hundreds of them has a problem worth seeing. */
  failed: number
  /** The tier's monthly allowance in SEK. */
  capSek: number
  /** Whether the cap has been reached — at or over, not merely approaching. */
  exceeded: boolean
  /** spentSek / capSek, clamped to 1. For a usage bar. */
  fraction: number
  /**
   * True when the SEK figures rest on the placeholder per-segment rate rather
   * than a confirmed one. Callers that display money must say so; see
   * cost.ts. A cap enforced on an unverified rate stops sending at the wrong
   * point in both directions.
   */
  usingFallbackRate: boolean
}

interface ReadArgs {
  service: SupabaseClient<Database>
  tenantId: string
  tier: string
  op: string
}

/**
 * This month's spend for one tenant, against its cap.
 *
 * Reads only rows for this tenant since the start of the UTC month — the
 * `(tenant_id, created_at desc)` index on sms_usage makes that a range scan.
 *
 * Returns null when usage could not be read. Callers treat null as "do not
 * block": see the fail-open note above.
 */
export async function readSmsCapStatus({
  service,
  tenantId,
  tier,
  op,
}: ReadArgs): Promise<SmsCapStatus | null> {
  const capSek = monthlySmsCapSek(tier)

  // Only `sent` rows carry segments, but failed rows are fetched too and
  // discarded by totalUsage — filtering here would mean two different
  // definitions of "this month's usage" in the codebase, and the row count is
  // small enough that the saving is theoretical.
  //
  // Wrapped in try/catch as well as checking `error`, so that a client which
  // throws rather than resolving — a misconfigured service client, a network
  // layer that rejects — fails open like every other unreadable-usage case
  // instead of turning a send into a 500. The whole point of this function is
  // that it can refuse to answer; it must never be the reason a send breaks.
  let data: { segments: number; status: string }[] | null = null

  try {
    const result = await service
      .from('sms_usage')
      .select('segments, status')
      .eq('tenant_id', tenantId)
      .gte('created_at', startOfMonthUtc())

    if (result.error) {
      logQueryError(result.error, {
        op,
        table: 'sms_usage',
        kind: 'select',
        tenantId,
        extra: { consequence: 'cap_not_enforced_send_allowed' },
      })
      return null
    }

    data = result.data
  } catch (err) {
    logQueryError(err as never, {
      op,
      table: 'sms_usage',
      kind: 'select',
      tenantId,
      extra: { consequence: 'cap_not_enforced_send_allowed' },
    })
    return null
  }

  const totals = totalUsage(data ?? [])
  const fraction = capSek > 0 ? Math.min(totals.sek / capSek, 1) : 1

  return {
    spentSek: totals.sek,
    segments: totals.segments,
    failed: totals.failed,
    capSek,
    exceeded: totals.sek >= capSek,
    fraction,
    usingFallbackRate: isUsingFallbackRate(),
  }
}

/**
 * Whether this tenant may send right now.
 *
 * Resolves to false only when usage was read successfully AND the cap is
 * reached. An unreadable usage table allows the send.
 */
export async function isSmsBlockedByCap(args: ReadArgs): Promise<boolean> {
  const status = await readSmsCapStatus(args)
  return status?.exceeded ?? false
}

export interface TenantSmsUsage extends SmsCapStatus {
  tenantId: string
  tenantName: string
  tier: string
}

interface ReadAllArgs {
  service: SupabaseClient<Database>
  /** The tenants to report on, already read by the caller. */
  tenants: { id: string; name: string; tier: string }[]
  op: string
}

/**
 * This month's spend for every tenant, for the system-admin overview (N24).
 *
 * One query for all of them rather than one per tenant. Three tenants today
 * makes the difference academic, but the shape of the wrong version — a loop
 * issuing a query each iteration — is the kind that looks fine until it is
 * quietly doing fifty, and this page is precisely where more tenants show up
 * first.
 *
 * Tenants with no usage are still returned, at zero. A system admin scanning
 * for a tenant about to be cut off needs to see every tenant in the list; one
 * that is missing because it has sent nothing reads as a tenant that is
 * missing.
 *
 * Returns null if usage could not be read at all — the caller shows nothing
 * rather than a table of zeroes, which would be indistinguishable from a
 * genuinely quiet month.
 */
export async function readAllTenantSmsUsage({
  service,
  tenants,
  op,
}: ReadAllArgs): Promise<TenantSmsUsage[] | null> {
  if (tenants.length === 0) return []

  let rows: { tenant_id: string; segments: number; status: string }[] | null = null

  try {
    const result = await service
      .from('sms_usage')
      .select('tenant_id, segments, status')
      .in(
        'tenant_id',
        tenants.map((t) => t.id)
      )
      .gte('created_at', startOfMonthUtc())

    if (result.error) {
      logQueryError(result.error, {
        op,
        table: 'sms_usage',
        kind: 'select',
        extra: { consequence: 'sysadmin_usage_overview_unavailable' },
      })
      return null
    }

    rows = result.data
  } catch (err) {
    logQueryError(err as never, {
      op,
      table: 'sms_usage',
      kind: 'select',
      extra: { consequence: 'sysadmin_usage_overview_unavailable' },
    })
    return null
  }

  const byTenant = new Map<string, { segments: number; status: string }[]>()
  for (const row of rows ?? []) {
    const list = byTenant.get(row.tenant_id)
    if (list) list.push(row)
    else byTenant.set(row.tenant_id, [row])
  }

  return tenants.map((tenant) => {
    const totals = totalUsage(byTenant.get(tenant.id) ?? [])
    const capSek = monthlySmsCapSek(tenant.tier)

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tier: tenant.tier,
      spentSek: totals.sek,
      segments: totals.segments,
      failed: totals.failed,
      capSek,
      exceeded: totals.sek >= capSek,
      fraction: capSek > 0 ? Math.min(totals.sek / capSek, 1) : 1,
      usingFallbackRate: isUsingFallbackRate(),
    }
  })
}
