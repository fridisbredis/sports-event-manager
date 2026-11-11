import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { verifyStandardWebhook } from '@/lib/auth/standard-webhook'
import { resolveOtpSender, type OtpSender } from '@/lib/sms/otp-sender'
import { toTwilioE164 } from '@/lib/phone'
import { getServerTranslation } from '@/lib/i18n/server'
import { logger } from '@/lib/logger'

// B14: Supabase Auth's Send SMS hook. With the hook enabled, GoTrue no longer
// sends one-time codes itself — every code (login, invite confirmation, claim)
// is POSTed here, and this route sends it via our own Twilio account, from the
// tenant's sender name when the number belongs to exactly one (see
// resolveOtpSender). The body names that tenant on every tier; only the
// alphanumeric sender is Professional.
//
// The cost of that, decided on the task board: every sign-in in the
// environment now depends on this route, system admins included. So:
//   - nothing that is only cosmetic may fail the request. A failed tenant
//     lookup sends from the platform number; a rejected alphanumeric send is
//     retried from the platform number once.
//   - only a missing secret, a bad signature, a malformed payload or Twilio
//     refusing the platform number too end in an error, and GoTrue then shows
//     the user an error instead of a code.
//
// Reached without a session (src/proxy.ts exempts this exact path); the
// Standard Webhooks signature is the whole guard. The service client is used
// because there is no user session — the caller is GoTrue.
//
// Neither the code nor the phone number is ever logged.

const payloadSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    phone: z.string().regex(/^\+?[1-9]\d{1,14}$/),
  }),
  sms: z.object({
    otp: z.string().min(1),
  }),
})

// GoTrue reads this shape from a non-2xx hook response and surfaces
// `message` as the auth error.
function hookError(status: number, message: string) {
  return NextResponse.json({ error: { http_code: status, message } }, { status })
}

function safeLog(fn: () => void) {
  try {
    fn()
  } catch {
    // Logging must never be able to change the response.
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.SEND_SMS_HOOK_SECRET
  if (!secret) {
    safeLog(() => logger.error('Send SMS hook blocked: SEND_SMS_HOOK_SECRET is not set'))
    return hookError(500, 'SMS hook is not configured')
  }

  const rawBody = await request.text()
  const verified = verifyStandardWebhook(
    secret,
    {
      id: request.headers.get('webhook-id'),
      timestamp: request.headers.get('webhook-timestamp'),
      signature: request.headers.get('webhook-signature'),
    },
    rawBody
  )
  if (!verified) {
    safeLog(() => logger.warn('Send SMS hook: rejected request with invalid signature'))
    return hookError(401, 'Invalid signature')
  }

  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    json = null
  }
  const parsed = payloadSchema.safeParse(json)
  if (!parsed.success) {
    safeLog(() => logger.error('Send SMS hook: payload did not match the expected shape'))
    return hookError(400, 'Invalid payload')
  }
  const { user, sms } = parsed.data

  const platformSender = process.env.TWILIO_PHONE_NUMBER
  if (!platformSender) {
    safeLog(() => logger.error('Send SMS hook blocked: TWILIO_PHONE_NUMBER is not set'))
    return hookError(500, 'SMS is not configured')
  }

  let client: ReturnType<typeof twilio>
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  } catch {
    // Not logged: the Twilio constructor quotes the offending credential.
    safeLog(() => logger.error('Send SMS hook blocked: Twilio client could not be constructed'))
    return hookError(500, 'SMS is not configured')
  }

  let sender: OtpSender
  try {
    sender = await resolveOtpSender(createSupabaseServiceClient(), user, platformSender)
  } catch {
    safeLog(() => logger.error('Send SMS hook: sender lookup threw, using the platform number'))
    sender = { from: platformSender, tenantName: null }
  }

  // Pinned to English like the invite SMS: the code is sent before we know
  // which user preferences apply, and the body is one short line either way.
  const t = await getServerTranslation('en', 'auth')
  const body = sender.tenantName
    ? t('otpSms.bodyNamed', { tenant: sender.tenantName, code: sms.otp })
    : t('otpSms.body', { code: sms.otp })
  const to = toTwilioE164(user.phone)

  try {
    await client.messages.create({ body, from: sender.from, to })
    return NextResponse.json({})
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    safeLog(() =>
      logger.error('Send SMS hook: Twilio send failed', undefined, {
        senderKind: sender.from === platformSender ? 'platform' : 'name',
        twilioCode: code ?? 'none',
      })
    )
    if (sender.from === platformSender) {
      return hookError(502, 'Failed to send SMS')
    }
  }

  // The name was refused (a destination that does not accept alphanumeric
  // senders, for one). The platform number is what GoTrue used before B14, so
  // it is the known-good fallback — a sign-in must not fail over a sender name.
  // The body keeps the tenant name: it still tells the reader who this is.
  try {
    await client.messages.create({ body, from: platformSender, to })
    return NextResponse.json({})
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    safeLog(() =>
      logger.error('Send SMS hook: platform-number retry failed', undefined, {
        twilioCode: code ?? 'none',
      })
    )
    return hookError(502, 'Failed to send SMS')
  }
}
