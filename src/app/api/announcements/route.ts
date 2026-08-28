import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { logAuditEvent } from '@/lib/audit/log-audit-event'
import type { AuditActorRole } from '@/types/app'
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

  // PERF-04: sending is no longer done inline. Enqueue one sms_queue row per
  // recipient and return immediately — the sms-queue-worker-trigger pg_cron
  // job (migration 0030) drains the queue every minute with bounded
  // concurrency and retry. The unique (announcement_id, recipient_phone)
  // constraint makes this insert idempotent if the client ever retries the
  // publish request.
  //
  // The announcements row above is deliberately left in place even if the
  // enqueue below fails partially or fully: it was written with
  // sms_sent: false, which the worker will correct once messages actually
  // go out. Rolling it back would need a transaction the rest of this
  // handler does not have.
  if (recipients && recipients.length > 0) {
    const { error: queueError } = await supabase.from('sms_queue').insert(
      recipients.map(({ phone }) => ({
        tenant_id: tenantId,
        announcement_id: announcement.id,
        recipient_phone: phone,
      }))
    )

    if (queueError) {
      logger.error('Failed to enqueue announcement SMS', queueError, {
        tenantId,
        announcementId: announcement.id,
      })
      return NextResponse.json({ error: 'Failed to queue SMS delivery' }, { status: 500 })
    }
  }

  await logAuditEvent({
    tenantId,
    actorUserId: auth.user.id,
    // requireTenantAdmin only ever returns 'system_admin' | 'tenant_admin',
    // though its type is the broader shared TenantRole.
    actorRole: auth.role as AuditActorRole,
    action: 'announcement_published',
    targetType: 'announcement',
    targetId: announcement.id,
    detail: { channel, recipientCount: recipients?.length ?? 0 },
  })

  return NextResponse.json(
    { announcementId: announcement.id, queued: recipients?.length ?? 0 },
    { status: 202 }
  )
}
