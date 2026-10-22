/**
 * Turning recorded SMS segments into SEK (N11).
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
 * SEK per SMS segment to Swedish mobile numbers.
 *
 * Deliberately NOT a verified figure. Twilio's Swedish outbound SMS price is
 * quoted in USD and varies by destination operator, and nobody has yet
 * confirmed what this account is actually charged — see the open question on
 * card N11. The fallback below is a placeholder of the right order of
 * magnitude so the measurement work is not blocked on a price lookup; it must
 * be replaced with a real figure before any number from here is shown as
 * money to anyone, let alone used to enforce a cap.
 */
const FALLBACK_SEK_PER_SEGMENT = 0.75

export function sekPerSegment(): number {
  const configured = Number(process.env.SMS_SEK_PER_SEGMENT)
  return Number.isFinite(configured) && configured > 0 ? configured : FALLBACK_SEK_PER_SEGMENT
}

/** Whether the rate in use is the placeholder rather than a configured one. */
export function isUsingFallbackRate(): boolean {
  const configured = Number(process.env.SMS_SEK_PER_SEGMENT)
  return !(Number.isFinite(configured) && configured > 0)
}

export interface SmsUsageTotals {
  /** Messages handed to Twilio and accepted. */
  sent: number
  /** Messages Twilio rejected, after retries. These cost nothing. */
  failed: number
  /** Billable segments across the sent messages. */
  segments: number
  /** segments × the configured rate. */
  sek: number
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
    sek: Math.round(segments * sekPerSegment() * 100) / 100,
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
