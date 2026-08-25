import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toTwilioE164 } from '@/lib/phone'

// SEC-09: triggered daily by the gdpr-warning-sms-trigger pg_cron job (migration
// 0029) via pg_net. Sends the 23-month inactivity warning SMS to officials and
// participants, and marks them so the same warning isn't re-sent every day.
// Never called directly by a browser — CRON_SECRET is the only guard, so an
// unset/mismatched secret must fail closed (401), not "no auth configured, proceed".
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('Authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER
  if (!fromNumber) {
    try {
      console.error('GDPR warning SMS blocked: TWILIO_PHONE_NUMBER is not set')
    } catch {
      // Logging must never be able to change the response.
    }
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  let client: ReturnType<typeof twilio>
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  } catch {
    try {
      console.error('GDPR warning SMS blocked: Twilio client could not be constructed')
    } catch {
      // Logging must never be able to change the response.
    }
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  const service = createSupabaseServiceClient()

  // Candidates: not already anonymized (user_id still set), not opted out of SMS,
  // and not already warned. Inactivity itself (last_sign_in_at) lives on auth.users,
  // so it's checked per-row below via get_last_sign_in_at rather than in this query.
  const [{ data: officials }, { data: participants }] = await Promise.all([
    service
      .from('officials')
      .select('id, tenant_id, name, phone, user_id, sms_opt_out')
      .not('user_id', 'is', null)
      .is('gdpr_warning_sent_at', null)
      .eq('sms_opt_out', false),
    service
      .from('participants')
      .select('id, tenant_id, name, phone, user_id, sms_opt_out')
      .not('user_id', 'is', null)
      .is('gdpr_warning_sent_at', null)
      .eq('sms_opt_out', false),
  ])

  const warningCutoff = Date.now() - 23 * 30 * 24 * 60 * 60 * 1000

  let sent = 0
  let failed = 0

  for (const table of ['officials', 'participants'] as const) {
    const rows = table === 'officials' ? officials : participants
    if (!rows) continue

    for (const row of rows) {
      const { data: lastSignInAt } = await service.rpc('get_last_sign_in_at', {
        p_user_id: row.user_id as string,
      })
      if (!lastSignInAt || new Date(lastSignInAt).getTime() > warningCutoff) continue

      try {
        await client.messages.create({
          body: `Hi ${row.name}, you haven't logged in for a while. If you don't log in again, your account will be automatically removed in about a month.`,
          from: fromNumber,
          to: toTwilioE164(row.phone),
        })
        sent += 1
      } catch (err) {
        failed += 1
        // Log the DB-generated id and Twilio's numeric code only — never the raw
        // error, which can echo the phone number back into the logs.
        const code = (err as { code?: unknown } | null)?.code
        try {
          console.error(
            `GDPR warning SMS failed for ${table} ${row.id} (twilio code: ${code ?? 'none'})`
          )
        } catch {
          // Logging must never be able to change the response.
        }
        continue
      }

      await service
        .from(table)
        .update({ gdpr_warning_sent_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('tenant_id', row.tenant_id)
    }
  }

  return NextResponse.json({ ok: true, sent, failed })
}
