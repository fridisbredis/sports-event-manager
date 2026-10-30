import { NextRequest, NextResponse } from 'next/server'
import twilio from 'twilio'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { toTwilioE164 } from '@/lib/phone'
import { logger } from '@/lib/logger'
import type { SmsQueueItem } from '@/types/app'
import { logQueryError } from '@/lib/db/query-error'
import { recordSmsUsage } from '@/lib/sms/usage'
import { readSmsCapStatus } from '@/lib/sms/cap'
import { sendSmsCapWarnings } from '@/lib/sms/cap-warning'
import { resolveSmsSender } from '@/lib/sms/sender'

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
    // N32: run on empty ticks too. Invites, resends and the other senders add
    // to a tenant's spend without ever putting a row in this queue.
    const capWarnings = await sendSmsCapWarnings({ service, client, fromNumber })
    return NextResponse.json({ sent: 0, failed: 0, retried: 0, deferred: 0, capWarnings })
  }

  // Prefetch each distinct announcement's body once, rather than re-querying
  // it per recipient — a single announcement can have up to 500 queued rows.
  const announcementIds = [...new Set(batch.map((row) => row.announcement_id))]
  const { data: announcementRows, error: announcementsError } = await service
    .from('announcements')
    .select('id, body')
    .in('id', announcementIds)

  // Throw rather than proceed with a partial map. Without this, a failed read
  // left bodyById empty and every message below went out with an empty body
  // (`?? ''`), was accepted by Twilio, and had its queue row marked 'sent' —
  // blank SMS to every recipient, irreversibly, with no retry because nothing
  // threw. Failing the tick leaves the rows queued for the next run instead.
  if (announcementsError) throw announcementsError

  const bodyById = new Map((announcementRows ?? []).map((a) => [a.id, a.body]))

  // N24: the monthly SMS spend cap, resolved once per distinct tenant in this
  // batch rather than once per message. A batch is up to 100 rows and may mix
  // tenants; checking per row would mean up to 100 usage queries per tick to
  // answer at most a handful of distinct questions.
  //
  // The snapshot is taken at the start of the tick and not refreshed as the
  // batch sends, so a tenant can cross its cap partway through and the rest of
  // that tick still goes out. That is deliberate: the alternative is a usage
  // query between every message, and overshooting by part of one batch is a
  // smaller problem than that. The next tick, a minute later, stops them.
  //
  // The same read also carries N13's sender name, so the sender costs no
  // extra query.
  const tenantIds = [...new Set(batch.map((row) => row.tenant_id))]
  const { data: tenantRows, error: tenantsError } = await service
    .from('tenants')
    .select('id, tier, sms_sender_id')
    .in('id', tenantIds)

  if (tenantsError) {
    // Logged, not thrown: failing the tick here would stop every tenant's
    // announcements because one tier lookup failed. The caps simply are not
    // enforced on this tick — the same fail-open posture as cap.ts — and every
    // message goes out from the platform number (resolveSmsSender on a
    // missing tenant).
    logQueryError(tenantsError, {
      op: 'POST /api/cron/sms-worker',
      table: 'tenants',
      kind: 'select',
      extra: { usage: 'sms_cap_tier', consequence: 'cap_not_enforced_send_allowed' },
    })
  }

  const tenantById = new Map((tenantRows ?? []).map((t) => [t.id, t]))
  const cappedTenants = new Set<string>()

  for (const tenantId of tenantIds) {
    const status = await readSmsCapStatus({
      service,
      tenantId,
      tier: tenantById.get(tenantId)?.tier ?? '',
      op: 'POST /api/cron/sms-worker',
    })

    if (status?.exceeded) {
      cappedTenants.add(tenantId)
      logger.warn(
        `Announcement SMS blocked by N24 monthly cap: tenant=${tenantId} ` +
          `spent=${status.spentAmount} cap=${status.capAmount}` +
          (status.usingFallbackRate
            ? ' (built-in per-segment rate, SMS_COST_PER_SEGMENT unset)'
            : '')
      )
    }
  }

  let sent = 0
  let failed = 0
  let retried = 0
  let deferred = 0

  // Rows belonging to a capped tenant are released back to 'pending' rather
  // than sent, failed, or left where they are.
  //
  // Not 'failed': nothing failed, and burning an attempt would retire the
  // message after three capped ticks — the announcement would be silently
  // dropped rather than delayed. Not left as 'sending': claim_sms_queue_batch
  // flipped them on claim, and a row abandoned in 'sending' is reclaimed only
  // by the stale-row path, if at all. 'pending' with attempts untouched means
  // they simply wait, and go out on the first tick after the month rolls over
  // or the tier changes.
  //
  // The queue is bounded and these rows keep being re-claimed each tick while
  // the cap holds, which is wasted work but bounded and visible in `deferred`.
  const sendable = batch.filter((row) => !cappedTenants.has(row.tenant_id))
  const blocked = batch.filter((row) => cappedTenants.has(row.tenant_id))

  if (blocked.length > 0) {
    const { error: deferError } = await service
      .from('sms_queue')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .in(
        'id',
        blocked.map((row) => row.id)
      )

    if (deferError) {
      // These rows are now stuck in 'sending' until something reclaims them.
      // Visible rather than silent, per F-REL-10.
      logQueryError(deferError, {
        op: 'POST /api/cron/sms-worker',
        table: 'sms_queue',
        kind: 'update',
        extra: {
          consequence: 'capped_rows_left_in_sending',
          rowCount: blocked.length,
        },
      })
    } else {
      deferred = blocked.length
    }
  }

  // Bounded concurrency: send CONCURRENCY messages at a time rather than
  // the whole batch at once, so one worker tick can't overwhelm Twilio's
  // rate limits the way the old fully-parallel Promise.allSettled did.
  for (let i = 0; i < sendable.length; i += CONCURRENCY) {
    const chunk = sendable.slice(i, i + CONCURRENCY)
    await Promise.allSettled(
      chunk.map(async (row) => {
        try {
          // An announcement whose row is missing or whose body is blank must
          // not be sent as an empty message — the recipient cannot unsend it,
          // and a blank SMS is worse than a delayed one. Treated as a failure
          // for this row so it follows the normal retry/last_error path below.
          const body = bodyById.get(row.announcement_id)
          if (!body) {
            throw new Error(`no body for announcement ${row.announcement_id}`)
          }

          const message = await client.messages.create({
            body,
            from: resolveSmsSender(tenantById.get(row.tenant_id), fromNumber),
            to: toTwilioE164(row.recipient_phone),
          })

          // N11: counted before the queue row is marked sent, so a message
          // that Twilio accepted is recorded even if the mark-sent write
          // below fails. Never throws — see recordSmsUsage.
          await recordSmsUsage({
            service,
            tenantId: row.tenant_id,
            kind: 'announcement',
            message,
            status: 'sent',
            op: 'POST /api/cron/sms-worker',
          })

          // The message is delivered; this write is the only record of that.
          // If it fails silently the row stays 'sending' and is either
          // reclaimed and sent twice, or stalls there forever — so it must be
          // visible even though there is nothing to roll back.
          const { error: markSentError } = await service
            .from('sms_queue')
            .update({ status: 'sent', updated_at: new Date().toISOString() })
            .eq('id', row.id)

          if (markSentError) {
            logQueryError(markSentError, {
              op: 'GET /api/cron/sms-worker',
              table: 'sms_queue',
              kind: 'update',
              tenantId: row.tenant_id,
              extra: {
                announcementId: row.announcement_id,
                consequence: 'row_stuck_sending_after_successful_send',
              },
            })
          }
          sent += 1
        } catch (err) {
          const attempts = row.attempts + 1
          const code = (err as { code?: unknown } | null)?.code
          // last_error stores Twilio's numeric code only — never the raw
          // error, which can quote the destination number back in its
          // message (see announcements/route.ts's original send loop).
          const willRetry = attempts < MAX_ATTEMPTS

          // N11: only the final failure is counted, not each retry — this
          // catch runs once per attempt, and recording all three would make
          // one undelivered message look like three in the tenant's usage.
          if (!willRetry) {
            await recordSmsUsage({
              service,
              tenantId: row.tenant_id,
              kind: 'announcement',
              message: null,
              status: 'failed',
              op: 'POST /api/cron/sms-worker',
            })
          }

          // Carries the incremented attempt count, so a silent failure here
          // costs the retry budget: the row returns to the pool with its old
          // `attempts` and can outlive MAX_ATTEMPTS.
          const { error: markFailedError } = await service
            .from('sms_queue')
            .update({
              status: willRetry ? 'pending' : 'failed',
              attempts,
              last_error: String(code ?? 'none'),
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)

          if (markFailedError) {
            logQueryError(markFailedError, {
              op: 'GET /api/cron/sms-worker',
              table: 'sms_queue',
              kind: 'update',
              tenantId: row.tenant_id,
              extra: {
                announcementId: row.announcement_id,
                consequence: 'attempt_count_not_recorded',
              },
            })
          }

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
    const { count, error: countError } = await service
      .from('sms_queue')
      .select('id', { count: 'exact', head: true })
      .eq('announcement_id', announcementId)
      .eq('status', 'sent')

    // A failed count is not zero. Left silent it reads as "nothing sent yet"
    // and sms_sent stays false on an announcement that did go out, which is
    // what COMM-01 shows the admin.
    if (countError) {
      logQueryError(countError, {
        op: 'GET /api/cron/sms-worker',
        table: 'sms_queue',
        kind: 'select',
        extra: { announcementId, stage: 'reconcile_count' },
      })
      continue
    }

    if (count && count > 0) {
      const { error: reconcileError } = await service
        .from('announcements')
        .update({ sms_sent: true })
        .eq('id', announcementId)

      if (reconcileError) {
        logQueryError(reconcileError, {
          op: 'GET /api/cron/sms-worker',
          table: 'announcements',
          kind: 'update',
          extra: { announcementId, stage: 'reconcile_sms_sent' },
        })
      }
    }
  }

  // N32: after this tick's sends, so spend they added counts towards the 90%
  // warning straight away rather than on the next tick. Never throws.
  const capWarnings = await sendSmsCapWarnings({ service, client, fromNumber })

  // `deferred` counts rows held back by a tenant's monthly cap (N24). They are
  // still queued and will go out once the cap clears — distinct from `failed`.
  // `capWarnings` is how many tenants were sent the N32 90% warning.
  return NextResponse.json({ sent, failed, retried, deferred, capWarnings })
}
