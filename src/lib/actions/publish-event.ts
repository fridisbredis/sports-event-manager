'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError } from '@/lib/actions/db-error-message'
import { eventInfoCacheTag, adminEventCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import { logQueryError } from '@/lib/db/query-error'

const tenantIdSchema = z.string().uuid()

export interface PublishEventInput {
  tenantSlug: string
  tenantId: string
  eventId: string
}

export interface PublishEventResult {
  error?: string
}

export async function publishEvent(input: PublishEventInput): Promise<PublishEventResult> {
  const supabase = await createSupabaseServerClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user

  // An expired or missing session is the ordinary path to the /login redirect
  // below and is not logged. A 5xx from GoTrue would otherwise look identical
  // to it, and the admin just gets bounced to /login with nothing recorded.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'publishEvent',
      table: 'auth.users',
      kind: 'select',
    })
  }

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(input.tenantId)
  if (!parsedTenantId.success) {
    const safeTenantIdForLog = String(input.tenantId).replace(/[\r\n]/g, '')
    logger.warn('publishEvent: invalid tenantId', { tenantId: safeTenantIdForLog })
    return { error: 'Not authorized' }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: 'Not authorized' }

  // EVT-02: name/status/Race-stage-count check and the publish write happen
  // inside this single RPC, under a row lock (SELECT ... FOR UPDATE) held
  // across both — see migration 20260908143523. Doing this as two separate
  // PostgREST calls (as before) left a TOCTOU window against a concurrent
  // sync_event_stages call removing the last Race stage.
  const { data: didPublish, error: rpcError } = await supabase.rpc('publish_event', {
    p_event_id: input.eventId,
    p_tenant_id: parsedTenantId.data,
  })

  if (rpcError) {
    // P0002 is the RPC's own "event not found" signal, not a failure — it is
    // raised for a bad id and shown to the operator as such, so logging it
    // would be noise on an ordinary 404. It still goes through the helper
    // below for its translated message.
    if (rpcError.code !== 'P0002') {
      logQueryError(rpcError, {
        op: 'publishEvent',
        table: 'publish_event',
        kind: 'rpc',
        tenantId: parsedTenantId.data,
        extra: { eventId: input.eventId },
      })
    }

    // 23514 covers publish_event's "name required" and "needs a Race stage"
    // checks — the client pre-validates both before calling, so this is a
    // rare backstop and one message naming both preconditions is sufficient
    // (unlike sync_event_stages, this path doesn't need them told apart).
    // The override is needed because 23514 maps to a stage-times message in
    // DB_ERROR_KEYS, which is about a different function entirely.
    // P0002 keeps the shared "not found" meaning from DB_ERROR_KEYS. Every
    // other code — a transient or infra failure the app can't interpret —
    // must get the generic fallback: claiming a precondition failed would
    // tell the admin something confidently wrong about an unrelated error.
    return {
      error: await translateDbError(
        'publishEvent: publish_event RPC failed',
        rpcError,
        'eventConfig.genericSaveError',
        { '23514': 'eventConfig.publishPreconditionFailed' },
        // This call site logs every code it means to log itself, just above,
        // via logQueryError — so the helper must not log a second, thinner
        // line for the same error.
        { log: false }
      ),
    }
  }

  // No-op: the event was already published, so nothing actually changed —
  // skip revalidation instead of paying for a cache invalidation that has
  // nothing to invalidate (matches pre-EVT-02 behavior).
  if (!didPublish) return {}

  revalidatePath(`/${input.tenantSlug}/admin/event`)
  revalidatePath(`/${input.tenantSlug}/admin/dashboard`)

  // PERF-06 / F-PERF-04 Phase 2 (ADR-0003): publishing only changes
  // events.status, which event-info and admin/event both read (workstations
  // doesn't read status, so no tag for it here). updateTag (not
  // revalidateTag) so the admin who just published sees it immediately.
  updateTag(eventInfoCacheTag(parsedTenantId.data))
  updateTag(adminEventCacheTag(parsedTenantId.data))

  // PERF-06 / F-PERF-04 Phase 3: the dashboard's cached summary also reads
  // events.status (the published/draft badge and canPublish/isPublished).
  updateTag(adminDashboardCacheTag(parsedTenantId.data))

  return {}
}
