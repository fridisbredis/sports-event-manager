/**
 * N13 — which sender an SMS goes out from.
 *
 * A tenant whose tier unlocks `smsSenderId` and has a name set sends from that
 * alphanumeric name ("Viadal"). Everyone else sends from the platform number
 * (TWILIO_PHONE_NUMBER). Sweden supports dynamic alphanumeric sender IDs with
 * no registration, so the name is a plain string on the tenant row — there is
 * nothing to buy or provision.
 *
 * Alphanumeric senders are one-way: a recipient cannot reply or text STOP.
 * Every SMS this app sends is one-way and opt-out lives in the app, which is
 * why this was acceptable (decided 2026-10-27, task board N13). A future
 * reply-based flow would need that tenant back on a number.
 */
import { z } from 'zod'
import { hasFeature } from '@/lib/tiers/features'

// Twilio's rule for an alphanumeric sender: at most 11 characters, ASCII
// letters, digits and space, at least one letter. Mirrors the
// tenants_sms_sender_id_format CHECK (migration 20261027143113), which is the
// backstop; this is what turns a bad value into a form error instead of a
// failed write.
export const SMS_SENDER_ID_MAX_LENGTH = 11

export const smsSenderIdSchema = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .pipe(
    z
      .string()
      .max(SMS_SENDER_ID_MAX_LENGTH)
      .regex(/^[A-Za-z0-9 ]+$/)
      .regex(/[A-Za-z]/)
      .nullable()
  )

// Gated on the READ, like effectivePalette: the stored name survives a
// downgrade untouched and comes back by itself on an upgrade.
//
// A tenant that could not be read sends from the platform number rather than
// not at all — the sender is cosmetic, the message is not.
export function resolveSmsSender(
  tenant: { tier: string; sms_sender_id: string | null } | null | undefined,
  platformSender: string
): string {
  if (!tenant?.sms_sender_id || !hasFeature(tenant.tier, 'smsSenderId')) {
    return platformSender
  }

  return tenant.sms_sender_id
}
