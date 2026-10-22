/**
 * Turning recorded SMS segments into money (N11).
 *
 * Twilio bills per SEGMENT, not per message: 160 GSM-7 characters, or 70 when
 * the body contains anything outside GSM-7. A long announcement is several
 * segments, so a cost figure built on message COUNT would understate spend.
 *
 * WHAT ACTUALLY FORCES UCS-2 (corrected 2026-10-22): not Swedish letters.
 * å, ä, ö, Å, Ä and Ö are all in the GSM-7 alphabet and cost one character
 * each — an earlier version of this comment claimed they halved the budget,
 * and that was simply wrong. What does force UCS-2 is typographic
 * punctuation: en/em dashes (–, —), curly quotes (’, ”), and the ellipsis
 * character (…). Those are easy to paste in from a word processor without
 * noticing, and one of them anywhere in the body cuts the limit from 160
 * characters to 70 for the whole message.
 *
 * The rate is configuration, not a constant in the code and not a column on
 * the usage rows:
 *
 *   - not a column, because storing the price per row freezes history against
 *     a rate that was right at the time. That sounds desirable until the rate
 *     is corrected, and then no total can ever be restated.
 *   - not a hardcoded constant, because Twilio's pricing changes and a deploy
 *     should not be needed to reflect that.
 *
 * Derived at read time means a total can always be recomputed from segments —
 * the one number that is a fact about the message rather than about a price
 * list.
 */

/**
 * The currency every SMS cost figure in the app is expressed in.
 *
 * One constant rather than 'SEK' written out at each call site, so changing
 * it is a single edit. The rest of the system is already currency-agnostic
 * by construction: sms_usage stores SEGMENTS, never money, and the amount is
 * derived at read time — so changing this restates history rather than
 * leaving old totals stranded in the old currency.
 *
 * It is deliberately NOT per tenant. The cap follows the tier and cannot be
 * set per tenant (Peter, 2026-10-20); giving tenants their own currencies
 * would make "300" mean different real limits on the same tier, which is
 * that rule broken by other means. It would also need an exchange rate per
 * currency, and a moving rate makes "what did March cost?" depend on when
 * you ask. Revisit only with a real non-Swedish customer, and as a decision
 * rather than a setting.
 */
export const SMS_COST_CURRENCY = 'SEK'

/**
 * Cost per SMS segment to Swedish mobile numbers, in SMS_COST_CURRENCY.
 *
 * MEASURED, no longer a guess (2026-10-22). Twilio's own usage summary for
 * September 2026 shows $1.81 across 28 outbound segments on this account —
 * $0.0646 per segment. At around 10.8 SEK/USD that is 0.70, which is the
 * figure below.
 *
 * Rounded slightly UP rather than to the 0.65 that today's rate gives exactly.
 * The price is quoted in USD and the exchange rate moves, and a rate that is
 * a little high stops a tenant marginally early, while one that is too low
 * lets them run past the cap without anyone noticing. Early is the right
 * direction for this error to point.
 *
 * Two things it does NOT cover, both deliberate:
 *   - Login OTP, which Supabase Auth sends through its own Twilio
 *     credentials. It appears on the invoice but never in sms_usage, so the
 *     per-tenant figure is an undercount. See cap.ts.
 *   - Phone number rental, which is a fixed monthly cost per number ($3 each,
 *     measured the same day) and not per segment. It belongs to N13, not here.
 *
 * Set SMS_COST_PER_SEGMENT to override without a deploy when Twilio's
 * pricing or the exchange rate moves enough to matter.
 */
const FALLBACK_COST_PER_SEGMENT = 0.7

/**
 * SMS_SEK_PER_SEGMENT is the old name, still read so an environment that has
 * it set does not silently fall back to the built-in rate on deploy. Remove
 * once both environments carry the new name.
 */
function configuredRate(): number {
  // `||`, not `??`: an env var set to an empty string is how a deployment
  // "unsets" one in practice, and `??` would treat that as a value and stop
  // looking — leaving an environment that still carries the old name on the
  // built-in rate.
  const value = process.env.SMS_COST_PER_SEGMENT || process.env.SMS_SEK_PER_SEGMENT
  return Number(value)
}

export function costPerSegment(): number {
  const configured = configuredRate()
  return Number.isFinite(configured) && configured > 0 ? configured : FALLBACK_COST_PER_SEGMENT
}

/** Whether the rate in use is the built-in one rather than a configured one. */
export function isUsingFallbackRate(): boolean {
  const configured = configuredRate()
  return !(Number.isFinite(configured) && configured > 0)
}

export interface SmsUsageTotals {
  /** Messages handed to Twilio and accepted. */
  sent: number
  /** Messages Twilio rejected, after retries. These cost nothing. */
  failed: number
  /** Billable segments across the sent messages. */
  segments: number
  /** segments × the configured rate, in SMS_COST_CURRENCY. */
  amount: number
}

interface UsageRow {
  segments: number
  status: string
}

/**
 * Totals for a set of usage rows.
 *
 * Failed sends are counted but contribute no segments and no cost: Twilio does
 * not charge for a message it refused. They are still worth surfacing — a
 * tenant generating hundreds of failures has a problem, and a total that
 * silently dropped them would disagree with the send-attempt count for no
 * visible reason.
 */
export function totalUsage(rows: UsageRow[]): SmsUsageTotals {
  let sent = 0
  let failed = 0
  let segments = 0

  for (const row of rows) {
    if (row.status === 'sent') {
      sent += 1
      segments += row.segments
    } else {
      failed += 1
    }
  }

  return {
    sent,
    failed,
    segments,
    // Rounded to öre. Summing unrounded and rounding once at the end, rather
    // than rounding per row, so a thousand messages do not accumulate a
    // thousand rounding errors.
    amount: Math.round(segments * costPerSegment() * 100) / 100,
  }
}

/**
 * The first instant of the current calendar month in UTC.
 *
 * The card asks for a cap "per month", which needs a boundary. UTC rather than
 * Europe/Stockholm to match the wall-clock-UTC convention the rest of this
 * codebase stores timestamps in — a tenant's month would otherwise shift by an
 * hour twice a year, and a usage total that moves is worse than one that is
 * an hour out of step with a calendar.
 */
export function startOfMonthUtc(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}
