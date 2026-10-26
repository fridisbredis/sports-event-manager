/**
 * N16 — the confirmation SMS an official gets when they confirm availability.
 *
 * Its value is not what it does on arrival: the recipient is signed in and
 * looking at the very page the link points to. The value is that the link
 * sits in their SMS thread afterwards, so they reopen the app from their
 * messages instead of typing a URL. A bookmark, not a receipt.
 *
 * Pinned to English (1c), like the invite SMS.
 */
import twilio from 'twilio'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { recordSmsUsage } from './usage'
import { toTwilioE164 } from '@/lib/phone'
import { logger } from '@/lib/logger'
import { logQueryError } from '@/lib/db/query-error'
import { buildAppLink } from './app-link'

export interface AvailabilityConfirmSmsInput {
  name?: string
  tenant: string
  url: string
}

export function buildAvailabilityConfirmSms(input: AvailabilityConfirmSmsInput): string {
  // The phone-fallback flow has no name to pass, so the greeting is dropped
  // and the sentence has to stand on its own — capitalised, not mid-sentence.
  const opening = input.name ? `Hi ${input.name}, your` : 'Your'

  // Deliberately short. The invite SMS is already two segments on prod
  // because of the URL length, and this one carries a URL too. Plain ASCII
  // only: a curly quote or an en dash anywhere in the body forces UCS-2 and
  // cuts the segment budget from 160 characters to 70.
  return `${opening} availability for ${input.tenant} is confirmed. Open the app any time: ${input.url}`
}

export interface AvailabilityConfirmRecipient {
  smsOptOut: boolean
}

export function shouldSendAvailabilityConfirmSms(recipient: AvailabilityConfirmRecipient): boolean {
  return !recipient.smsOptOut
}

/**
 * The tenant home, which is where this SMS's bookmark points. The origin
 * handling it shares with the invite links lives in buildAppLink (B9).
 */
export function buildTenantHomeLink(tenantSlug: string): string | null {
  return buildAppLink(`/${tenantSlug}/home`)
}

/**
 * Best-effort send, shared by both confirm flows (the token route and the
 * phone-fallback action). The confirmation has already committed by the time
 * this runs, so nothing in here may throw: a missing slug, an opted-out
 * official, a misconfigured origin or a dead Twilio each end in a return,
 * never in a failed confirmation.
 */
export async function sendAvailabilityConfirmSms({
  service,
  tenantId,
  tenantSlug,
  phone,
  name,
  op,
}: {
  service: SupabaseClient<Database>
  tenantId: string
  tenantSlug: string | undefined
  phone: string | undefined
  name?: string
  op: string
}): Promise<void> {
  if (!tenantSlug || !phone) return

  const url = buildTenantHomeLink(tenantSlug)
  // A misconfigured origin would otherwise send "undefined/<slug>/home" — an
  // SMS that has already cost money and can never work. No link, no send.
  if (!url) {
    logger.error('Availability confirm SMS skipped: no usable app URL', undefined, { tenantId })
    return
  }

  const { data: official, error } = await service
    .from('officials')
    .select('sms_opt_out')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .maybeSingle()

  if (error) {
    logQueryError(error, {
      op,
      table: 'officials',
      kind: 'select',
      tenantId,
      extra: { usage: 'availability_confirm_sms' },
    })
    return
  }

  if (!official || !shouldSendAvailabilityConfirmSms({ smsOptOut: official.sms_opt_out })) {
    return
  }

  const body = buildAvailabilityConfirmSms({ name, tenant: tenantSlug, url })

  // Constructed inside the try: twilio() throws synchronously on a non-AC
  // account SID, and that would otherwise escape into a confirmation that
  // already succeeded.
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    const message = await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER!,
      to: toTwilioE164(phone),
    })
    await recordSmsUsage({
      service,
      tenantId,
      kind: 'availability_confirm',
      message,
      status: 'sent',
      op,
    })
  } catch (err) {
    // Never the raw error — it echoes the phone number.
    logger.error('Availability confirm SMS failed', undefined, {
      code: (err as { code?: number }).code,
      tenantId,
    })
    await recordSmsUsage({
      service,
      tenantId,
      kind: 'availability_confirm',
      message: null,
      status: 'failed',
      op,
    })
  }
}
