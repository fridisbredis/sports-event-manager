import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toTwilioE164 } from '@/lib/phone'
import { logger } from '@/lib/logger'
import type { SmsQueueItem } from '@/types/app'

// PERF-04: triggered every minute by the sms-queue-worker-trigger pg_cron job
// (migration 0030) via pg_net, same pattern as the gdpr-warning cron route.
// Drains one bounded batch of the sms_queue table with bounded concurrency,
// retrying failures up to MAX_ATTEMPTS before giving up on a row. Never
// called directly by a browser — CRON_SECRET is the only guard, so an
// unset/mismatched secret must fail closed (401).
const BATCH_SIZE = 100
const CONCURRENCY = 10
const MAX_ATTEMPTS = 3

export async function POST(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('Authorization')
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER
  if (!fromNumber) {
    logger.error('SMS worker blocked: TWILIO_PHONE_NUMBER is not set')
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  let client: ReturnType<typeof twilio>
  try {
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  } catch (err) {
    logger.error('SMS worker blocked: Twilio client could not be constructed', err)
    return NextResponse.json({ error: 'SMS is not configured' }, { status: 500 })
  }

  const service = createSupabaseServiceClient()

  // Atomically claims and flips rows to 'sending' (SKIP LOCKED), so a
  // second overlapping worker run (e.g. a slow prior invocation still
  // in flight) can't claim the same row twice.
  const { data: claimed, error: claimError } = await service.rpc('claim_sms_queue_batch', {
    p_batch_size: BATCH_SIZE,
  })

  if (claimError) {
    logger.error('SMS worker failed to claim queue batch', claimError)
    return NextResponse.json({ error: 'Failed to claim queue batch' }, { status: 500 })
  }

  const batch = (claimed ?? []) as SmsQueueItem[]
  if (batch.length === 0) {
    return NextResponse.json({ sent: 0, failed: 0, retried: 0 })
  }

  // Prefetch each distinct announcement's body once, rather than re-querying
  // it per recipient — a single announcement can have up to 500 queued rows.
  const announcementIds = [...new Set(batch.map((row) => row.announcement_id))]
  const { data: announcementRows } = await service
    .from('announcements')
    .select('id, body')
    .in('id', announcementIds)
  const bodyById = new Map((announcementRows ?? []).map((a) => [a.id, a.body]))

  let sent = 0
  let failed = 0
  let retried = 0

  // Bounded concurrency: send CONCURRENCY messages at a time rather than
  // the whole batch at once, so one worker tick can't overwhelm Twilio's
  // rate limits the way the old fully-parallel Promise.allSettled did.
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY)
    await Promise.allSettled(
      chunk.map(async (row) => {
        try {
          await client.messages.create({
            body: bodyById.get(row.announcement_id) ?? '',
            from: fromNumber,
            to: toTwilioE164(row.recipient_phone),
          })

          await service
            .from('sms_queue')
            .update({ status: 'sent', updated_at: new Date().toISOString() })
            .eq('id', row.id)
          sent += 1
        } catch (err) {
          const attempts = row.attempts + 1
          const code = (err as { code?: unknown } | null)?.code
          // last_error stores Twilio's numeric code only — never the raw
          // error, which can quote the destination number back in its
          // message (see announcements/route.ts's original send loop).
          const willRetry = attempts < MAX_ATTEMPTS

          await service
            .from('sms_queue')
            .update({
              status: willRetry ? 'pending' : 'failed',
              attempts,
              last_error: String(code ?? 'none'),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)

          if (willRetry) {
            retried += 1
          } else {
            failed += 1
          }

          logger.error('SMS worker send failed', undefined, {
            tenantId: row.tenant_id,
            announcementId: row.announcement_id,
            attempts,
            twilioCode: code ?? 'none',
            willRetry,
          })
        }
      })
    )
  }

  // Reconcile sms_sent on every announcement touched this tick: true once
  // at least one recipient has been sent, false only while none have yet.
  for (const announcementId of announcementIds) {
    const { count } = await service
      .from('sms_queue')
      .select('id', { count: 'exact', head: true })
      .eq('announcement_id', announcementId)
      .eq('status', 'sent')

    if (count && count > 0) {
      await service.from('announcements').update({ sms_sent: true }).eq('id', announcementId)
    }
  }

  return NextResponse.json({ sent, failed, retried })
}
