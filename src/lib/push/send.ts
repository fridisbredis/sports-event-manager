import webpush, { WebPushError } from 'web-push'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { logQueryError } from '@/lib/db/query-error'

// N31: server side of Web Push. Push is sent IN ADDITION to SMS, never
// instead of it, so nothing here may throw into the caller or hold anything
// up — a push that does not arrive costs nothing the SMS does not cover.
//
// Sent once, at publish time, rather than from the SMS worker. The worker
// retries per SMS row and holds rows back under the monthly SMS cap (N24);
// neither should apply to push, which costs nothing and has no retry budget
// worth tracking. The caller runs this inside after(), so the admin's publish
// response does not wait on Apple's or Google's push services.

const OP = 'announcement push'
const CONCURRENCY = 10

// Push services cap the encrypted payload at 4096 bytes. An announcement may
// be 1600 characters, which in UTF-8 can exceed that once encrypted, so the
// notification carries a preview and the full text is one tap away.
const PREVIEW_LENGTH = 300

// An announcement read a day late is still worth showing; one read a week
// late is not. Push services drop the message after this if the device stays
// offline.
const TTL_SECONDS = 24 * 60 * 60

interface AnnouncementPush {
  tenantId: string
  eventId: string
  body: string
}

export interface PushOutcome {
  sent: number
  failed: number
  removed: number
}

const NONE: PushOutcome = { sent: 0, failed: 0, removed: 0 }

function preview(body: string): string {
  return body.length <= PREVIEW_LENGTH ? body : `${body.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…`
}

// The endpoint is a per-device URL at a third-party push service, so it is
// personal data and never logged whole. Its host says which service answered,
// which is all a log reader needs.
function pushHost(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return 'invalid'
  }
}

function vapidDetails() {
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  // The subject tells a push service whom to contact about this sender. It
  // must be https: or mailto:, and Apple rejects localhost, so the app's own
  // public URL is used and a local run without one simply sends nothing.
  const subject = process.env.NEXT_PUBLIC_APP_URL
  if (!publicKey || !privateKey || !subject?.startsWith('https://')) return null
  return { subject, publicKey, privateKey }
}

export async function sendAnnouncementPush({
  tenantId,
  eventId,
  body,
}: AnnouncementPush): Promise<PushOutcome> {
  try {
    const vapid = vapidDetails()
    if (!vapid) {
      logger.warn(`${OP} skipped: VAPID keys or an https app URL are not configured`, {
        tenantId,
      })
      return NONE
    }

    const service = createSupabaseServiceClient()

    // The event's confirmed officials who have ever signed in (user_id is set
    // at confirm time). sms_opt_out is deliberately NOT filtered: it opts out
    // of SMS, and push is a separate opt-in made on the device itself.
    const { data: officials, error: officialsError } = await service
      .from('officials')
      .select('user_id, official_events!inner(event_id)')
      .eq('tenant_id', tenantId)
      .eq('official_events.event_id', eventId)
      .eq('invite_status', 'confirmed')
      .not('user_id', 'is', null)

    if (officialsError) {
      logQueryError(officialsError, {
        op: OP,
        table: 'officials',
        kind: 'select',
        tenantId,
        extra: { eventId, consequence: 'push_not_sent' },
      })
      return NONE
    }

    const userIds = [
      ...new Set((officials ?? []).map((o) => o.user_id).filter((id): id is string => id !== null)),
    ]
    if (userIds.length === 0) return NONE

    const [{ data: devices, error: devicesError }, { data: tenant, error: tenantError }] =
      await Promise.all([
        service.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', userIds),
        service.from('tenants').select('name, slug').eq('id', tenantId).single(),
      ])

    if (devicesError || tenantError || !tenant) {
      logQueryError(devicesError ?? tenantError, {
        op: OP,
        table: devicesError ? 'push_subscriptions' : 'tenants',
        kind: 'select',
        tenantId,
        extra: { eventId, consequence: 'push_not_sent' },
      })
      return NONE
    }

    if (!devices || devices.length === 0) return NONE

    // The notification opens the announcements tab of this event, which shows
    // the full text the preview may have cut.
    const payload = JSON.stringify({
      title: tenant.name,
      body: preview(body),
      url: `/${tenant.slug}/events/${eventId}/announcements`,
    })

    const outcome: PushOutcome = { sent: 0, failed: 0, removed: 0 }
    const gone: string[] = []

    for (let i = 0; i < devices.length; i += CONCURRENCY) {
      const chunk = devices.slice(i, i + CONCURRENCY)
      await Promise.allSettled(
        chunk.map(async (device) => {
          try {
            await webpush.sendNotification(
              { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
              payload,
              { vapidDetails: vapid, TTL: TTL_SECONDS, urgency: 'high' }
            )
            outcome.sent += 1
          } catch (err) {
            const status = err instanceof WebPushError ? err.statusCode : undefined
            // 404/410: the push service no longer knows this subscription
            // (app removed, permission revoked, subscription expired). It will
            // never work again, so the row goes rather than being retried on
            // every announcement.
            if (status === 404 || status === 410) {
              gone.push(device.endpoint)
              return
            }
            outcome.failed += 1
            logger.error(`${OP} failed`, undefined, {
              tenantId,
              eventId,
              pushHost: pushHost(device.endpoint),
              statusCode: status ?? 'none',
            })
          }
        })
      )
    }

    if (gone.length > 0) {
      const { error: deleteError } = await service
        .from('push_subscriptions')
        .delete()
        .in('endpoint', gone)

      if (deleteError) {
        // Not lost: the next announcement gets the same 404/410 and retries
        // the delete.
        logQueryError(deleteError, {
          op: OP,
          table: 'push_subscriptions',
          kind: 'delete',
          tenantId,
          extra: { rowCount: gone.length, consequence: 'expired_subscriptions_kept' },
        })
      } else {
        outcome.removed = gone.length
      }
    }

    logger.info(`${OP} done`, { tenantId, eventId, ...outcome })
    return outcome
  } catch (err) {
    logger.error(`${OP} crashed`, err, { tenantId, eventId })
    return NONE
  }
}
