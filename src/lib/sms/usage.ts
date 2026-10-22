import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { logQueryError } from '@/lib/db/query-error'

/**
 * Per-tenant SMS usage accounting (N11).
 *
 * One row per message handed to Twilio, written by every send path. The point
 * is a truthful per-tenant total: nothing in this system has ever counted an
 * SMS per tenant, so no cap can be set until this has run for an event.
 *
 * It does NOT cover login OTP, which Supabase Auth sends through its own
 * Twilio credentials — we never see that call. A tenant's recorded spend is
 * its announcement, invite and GDPR-warning traffic. See the migration header
 * for why that gap is acceptable (the cap must never block login anyway) and
 * why it still has to be stated: the SEK figure is an undercount.
 */

export type SmsKind =
  | 'invite'
  | 'invite_resend'
  | 'announcement'
  | 'gdpr_warning'
  | 'availability_confirm'

/** The shape of a Twilio create() response, narrowed to what we record. */
interface TwilioMessageLike {
  sid?: string | null
  numSegments?: string | null
  price?: string | null
  priceUnit?: string | null
}

/**
 * Twilio returns numSegments as a string ("1", "2"). Anything unreadable
 * counts as one segment rather than zero: this table will eventually back a
 * spending cap, and undercounting spend is the more dangerous error.
 */
export function parseSegments(numSegments: string | null | undefined): number {
  const n = Number(numSegments)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/**
 * Twilio's price is a negative string ("-0.0685") and is usually null at
 * create time — it is only set once the message reaches a terminal delivery
 * state. Stored when present for later reconciliation against an invoice;
 * nothing derives SEK from it.
 */
export function parsePrice(price: string | null | undefined): number | null {
  if (price === null || price === undefined || price === '') return null
  const n = Number(price)
  return Number.isFinite(n) ? n : null
}

interface RecordSmsUsageArgs {
  service: SupabaseClient<Database>
  tenantId: string
  kind: SmsKind
  /** The Twilio create() response, or null when the send threw. */
  message: TwilioMessageLike | null
  status: 'sent' | 'failed'
  /** For the log line when the insert itself fails. */
  op: string
}

/**
 * Records one send. Never throws.
 *
 * Accounting must not be able to break sending: the message has already gone
 * out by the time this runs, and raising here would turn a delivered SMS into
 * a failed request — the caller would retry and the recipient would get it
 * twice. A failed insert is logged (so a silent accounting gap is visible,
 * per F-REL-10) and swallowed.
 */
export async function recordSmsUsage({
  service,
  tenantId,
  kind,
  message,
  status,
  op,
}: RecordSmsUsageArgs): Promise<void> {
  try {
    const { error } = await service.from('sms_usage').insert({
      tenant_id: tenantId,
      kind,
      status,
      message_sid: message?.sid ?? null,
      segments: parseSegments(message?.numSegments),
      price: parsePrice(message?.price),
      price_unit: message?.priceUnit ?? null,
    })

    if (error) {
      logQueryError(error, {
        op,
        table: 'sms_usage',
        kind: 'insert',
        tenantId,
        extra: { smsKind: kind, consequence: 'sms_not_counted_towards_tenant_usage' },
      })
    }
  } catch (err) {
    // A throw here would be a bug in this helper rather than a query error,
    // but the consequence is the same and the message is already sent.
    logQueryError(err as never, {
      op,
      table: 'sms_usage',
      kind: 'insert',
      tenantId,
      extra: { smsKind: kind, consequence: 'sms_not_counted_towards_tenant_usage' },
    })
  }
}
