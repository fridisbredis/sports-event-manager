'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError } from '@/lib/actions/db-error-message'
import { eventInfoCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import { logQueryError } from '@/lib/db/query-error'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { adminEventRoutePattern } from '@/lib/events/paths'
import { canPublish } from '@/lib/events/participant-side'

const tenantIdSchema = z.string().uuid()
const eventIdSchema = z.string().uuid()

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
    return { error: await tError('actionErrors.notAuthorized') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: await tError('actionErrors.notAuthorized') }

  // N36 / PB5: publishing is Premium and up. Read from the database, never
  // taken from the caller, because it governs access. publish_event refuses
  // a Standard tenant itself as well (P0005, migration 20261106123522) — this
  // check is the app layer's half and gives the precise message without a
  // round trip into the lock.
  const { data: tierRow, error: tierError } = await supabase
    .from('tenants')
    .select('tier')
    .eq('id', parsedTenantId.data)
    .maybeSingle()

  if (tierError) {
    logQueryError(tierError, {
      op: 'publishEvent',
      table: 'tenants',
      kind: 'select',
      tenantId: parsedTenantId.data,
    })
    return {
      error: await translateDbError(
        'publishEvent: tier lookup failed',
        tierError,
        'eventConfig.genericSaveError',
        {},
        { log: false }
      ),
    }
  }

  if (!tierRow || !canPublish(tierRow.tier)) {
    logger.warn('publishEvent: tier does not include publishing', {
      tenantId: parsedTenantId.data,
      tier: tierRow?.tier,
    })
    return { error: await tError('actionErrors.publishNeedsPremium') }
  }

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
    // P0005 is publish_event's own tier refusal — the same answer as the
    // check above, reached only if the tier changed in between.
    if (rpcError.code === 'P0005') {
      return { error: await tError('actionErrors.publishNeedsPremium') }
    }

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

  revalidatePublishStatus(parsedTenantId.data)

  return {}
}

// Everything that shows the published/draft status, shared with
// unpublishEvent below.
function revalidatePublishStatus(tenantId: string) {
  revalidatePath('/[tenantSlug]/admin', 'page')
  revalidatePath(adminEventRoutePattern('event'), 'page')
  revalidatePath(adminEventRoutePattern('dashboard'), 'page')

  // PERF-06 / F-PERF-04 Phase 2 (ADR-0003): publishing only changes
  // events.status, which the cached event-info page reads (admin/event reads
  // it uncached). updateTag (not revalidateTag) so it shows immediately.
  updateTag(eventInfoCacheTag(tenantId))

  // PERF-06 / F-PERF-04 Phase 3: the dashboard's cached summary also reads
  // events.status (the published/draft badge and canPublish/isPublished).
  updateTag(adminDashboardCacheTag(tenantId))
}

export type UnpublishEventInput = PublishEventInput
export type UnpublishEventResult = PublishEventResult

// N36 / PB3: unpublish closes the participant side "for a while". It is a
// status change and nothing else — participant records, claims and accounts
// are all kept, so publishing again brings back exactly what was there.
//
// One guarded UPDATE through the RLS client (tenant_admin_manage_events is the
// database's check, hasAdminAccessToTenant and the tenant filter the app's).
// No RPC: going back to draft can only relax the published => Race stage
// invariant that publish_event and sync_event_stages lock against, never
// break it, so there is no check-then-write to protect. `.eq('status',
// 'published')` makes a double click, a stale page or an archived event a
// no-op rather than a status change.
//
// Not tier-gated: closing is always allowed. A Standard tenant's admin is
// never shown the button (its events always read as Draft, PB11), but a
// stored 'published' from before a downgrade may still be cleared.
export async function unpublishEvent(input: UnpublishEventInput): Promise<UnpublishEventResult> {
  const supabase = await createSupabaseServerClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const user = authData.user

  // Same reasoning as publishEvent: only a GoTrue 5xx is worth a log line.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'unpublishEvent',
      table: 'auth.users',
      kind: 'select',
    })
  }

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(input.tenantId)
  const parsedEventId = eventIdSchema.safeParse(input.eventId)
  if (!parsedTenantId.success || !parsedEventId.success) {
    return { error: await tError('actionErrors.invalidRequest') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: await tError('actionErrors.notAuthorized') }

  const { data, error } = await supabase
    .from('events')
    .update({ status: 'draft' })
    .eq('id', parsedEventId.data)
    .eq('tenant_id', parsedTenantId.data)
    .eq('status', 'published')
    .select('id')

  if (error) {
    logQueryError(error, {
      op: 'unpublishEvent',
      table: 'events',
      kind: 'update',
      tenantId: parsedTenantId.data,
      extra: { eventId: parsedEventId.data },
    })
    return {
      error: await translateDbError(
        'unpublishEvent: update failed',
        error,
        'eventConfig.genericSaveError',
        {},
        { log: false }
      ),
    }
  }

  if (data.length === 0) return {}

  revalidatePublishStatus(parsedTenantId.data)

  return {}
}
