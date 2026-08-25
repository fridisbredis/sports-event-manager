import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { toTwilioE164 } from '@/lib/phone'
import { logger } from '@/lib/logger'
import twilio from 'twilio'
import { z } from 'zod'

const publishSchema = z.object({
  tenantId: z.string().uuid(),
  channel: z.enum(['officials', 'participants']),
  body: z.string().min(1).max(1600),
})

// PERF-02's proposed baseline caps a single announcement audience at 500
// recipients. The limit is enforced here, not just assumed, so the recipient
// query can never grow unbounded with tenant size (F-SEC-04/PERF-06).
const MAX_ANNOUNCEMENT_RECIPIENTS = 500

export async function POST(request: NextRequest) {
  // Validate body first so we have tenantId for the auth check
  const json = await request.json()
  const parsed = publishSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { tenantId, channel, body } = parsed.data

  // Auth + tenant authorization in one call
  const auth = await requireTenantAdmin(tenantId)
  if ('error' in auth) return auth.error

  // ...rest of the handler unchanged (fetch recipients, insert announcement, send SMS)
  const supabase = await createSupabaseServerClient()

  // Officials keep their row (and phone number) after being removed, so the
  // officials channel must also exclude anyone who isn't a confirmed
  // official — otherwise a removed official (or a re-invited one on the
  // same number) still receives announcement SMS. Participants have no
  // such status. Branching on `channel` (rather than a shared `table`
  // variable) keeps each query's column types scoped to its own table.
  const { data: recipients, error } =
    channel === 'officials'
      ? await supabase
          .from('officials')
          .select('phone')
          .eq('tenant_id', tenantId)
          .eq('sms_opt_out', false)
          .eq('invite_status', 'confirmed')
          .limit(MAX_ANNOUNCEMENT_RECIPIENTS)
      : await supabase
          .from('participants')
          .select('phone')
          .eq('tenant_id', tenantId)
          .eq('sms_opt_out', false)
          .limit(MAX_ANNOUNCEMENT_RECIPIENTS)

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch recipients' }, { status: 500 })
  }

  if (recipients && recipients.length === MAX_ANNOUNCEMENT_RECIPIENTS) {
    try {
      logger.warn(
        'Announcement recipient count hit the cap — some recipients were silently excluded',
        {
          tenantId,
          channel,
          cap: MAX_ANNOUNCEMENT_RECIPIENTS,
        }
      )
    } catch {
      // Logging must never be able to change the response - see the send loop below.
    }
  }

  const { data: announcement, error: insertError } = await supabase
    .from('announcements')
    .insert({
      tenant_id: tenantId,
      channel,
      body,
      sms_sent: false,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertError || !announcement) {
    logger.error('Failed to record announcement', insertError, { tenantId })
    return NextResponse.json({ error: 'Failed to publish announcement' }, { status: 500 })
  }

  // The sender number and the client are resolved before any send, and a fault in either
  // is our own configuration rather than a provider rejection, so both answer a
  // controlled 500 with a client-safe message - the same shape the resend route uses.
  // Without this guard twilio() throws synchronously on an unset or non-AC
  // TWILIO_ACCOUNT_SID and escapes the handler entirely, leaving the admin with an
  // unhandled 500 and no way to tell whether any of the announcement went out.
  //
  // The announcements row inserted above is deliberately left in place on this path. It
  // was written with sms_sent: false, which is exactly what happened: the announcement is
  // published and no SMS was sent. Rolling it back would need a transaction the rest of
  // this handler does not have.
  const fromNumber = process.env.TWILIO_PHONE_NUMBER
  if (!fromNumber) {
    try {
      logger.error('Announcement SMS blocked: TWILIO_PHONE_NUMBER is not set', undefined, {
        tenantId,
      })
    } catch {
      // Logging must never be able to change the response - see the send loop below.
    }
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  let client: ReturnType<typeof twilio>
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  } catch {
    // The caught error is never logged: the Twilio constructor quotes the offending
    // credential back in its own message.
    try {
      logger.error('Announcement SMS blocked: Twilio client could not be constructed', undefined, {
        tenantId,
      })
    } catch {
      // Logging must never be able to change the response - see the send loop below.
    }
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  const results = await Promise.allSettled(
    (recipients ?? []).map(({ phone }) =>
      client.messages.create({
        body,
        from: fromNumber,
        to: toTwilioE164(phone),
      })
    )
  )

  // Count and log in one pass. Each rejection is recorded with Twilio's numeric code
  // only - never the raw error and never the number, because a Twilio rejection quotes
  // the destination back in its message ("Invalid To number: +46..."). Recipients are
  // identified by their position in the batch, which is enough to line a failure up
  // against the send order without putting PII in the log.
  //
  // The try wraps each log rather than the whole loop: console patching by editor
  // extensions can throw, and a throw that aborted the loop would leave `failed`
  // undercounted and report a partial send as a clean one.
  let failed = 0
  for (const [index, result] of results.entries()) {
    if (result.status !== 'rejected') continue

    failed += 1
    const code = (result.reason as { code?: unknown } | null)?.code
    try {
      logger.error('Announcement SMS failed for recipient', undefined, {
        tenantId,
        channel,
        recipientIndex: index,
        twilioCode: code ?? 'none',
      })
    } catch {
      // Logging must never be able to change the response.
    }
  }

  const sent = results.length - failed
  const { error: updateError } = await supabase
    .from('announcements')
    .update({ sms_sent: sent > 0 })
    .eq('id', announcement.id)

  if (updateError) {
    logger.error('Failed to record delivery outcome for announcement', updateError, {
      tenantId,
      announcementId: announcement.id,
    })
  }

  return NextResponse.json({ sent, failed })
}
