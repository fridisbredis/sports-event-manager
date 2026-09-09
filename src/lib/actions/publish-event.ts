'use server'

import { redirect } from 'next/navigation'
import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { eventInfoCacheTag, adminEventCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'

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
  const {
    data: { user },
  } = await supabase.auth.getUser()

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
    if (rpcError.code === 'P0002') return { error: 'Event not found.' }
    return { error: rpcError.message }
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
