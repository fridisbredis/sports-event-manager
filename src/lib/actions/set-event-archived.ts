'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminTenant } from '@/lib/auth/tenant'
import { maxActiveEvents } from '@/lib/tiers/features'
import { logQueryError } from '@/lib/db/query-error'
import { translateDbError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { eventInfoCacheTag, adminEventCacheTag, adminDashboardCacheTag } from '@/lib/cache/tags'
import { adminEventRoutePattern } from '@/lib/events/paths'

const eventIdSchema = z.string().uuid()

export interface SetEventArchivedInput {
  tenantSlug: string
  eventId: string
  archived: boolean
}

export interface SetEventArchivedResult {
  error?: string
}

// N23 / TEN-01: archive an event, or bring an archived one back.
//
// Archiving frees one of the tenant's MAX_ACTIVE_EVENTS slots, and the
// archive lock (migration 20261028103213) then refuses every edit to the
// event row except its status. Un-archiving takes a slot back, which
// enforce_event_cap checks under a lock on the tenant row — so two admins
// un-archiving at once cannot both slip under the cap. This action does not
// count slots itself; it reads the trigger's P0001 and explains it.
//
// An un-archived event comes back as a draft, whatever it was before: it has
// been out of use, and publishing it again should be a decision, not a side
// effect of restoring it.
//
// One write, so no RPC (REL-01 is about two or more). It goes through the
// RLS client: tenant_admin_manage_events is the database's check, and
// getAdminTenant plus the tenant filter are the app's.
export async function setEventArchived(
  input: SetEventArchivedInput
): Promise<SetEventArchivedResult> {
  const tenant = await getAdminTenant(input.tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const parsedEventId = eventIdSchema.safeParse(input.eventId)
  if (!parsedEventId.success) return { error: await tError('actionErrors.invalidRequest') }

  const supabase = await createSupabaseServerClient()
  let query = supabase
    .from('events')
    .update({ status: input.archived ? 'archived' : 'draft' })
    .eq('id', parsedEventId.data)
    .eq('tenant_id', tenant.id)
  // Only rows that actually change, so a double click or a stale page is a
  // no-op rather than turning a published event into a draft.
  query = input.archived ? query.neq('status', 'archived') : query.eq('status', 'archived')

  const { data, error } = await query.select('id')

  if (error) {
    // P0001 from enforce_event_cap is the ordinary "no free slot" answer to
    // an un-archive, not a failure worth a log line.
    if (error.code === 'P0001') {
      // Peter, N23 (c): with a single slot there is nothing to upgrade
      // within reach of the admin's own action, so the message says which
      // step frees one.
      const key =
        maxActiveEvents(tenant.tier) === 1
          ? 'actionErrors.unarchiveArchiveFirst'
          : 'actionErrors.unarchiveUpgrade'
      return { error: await tError(key) }
    }

    logQueryError(error, {
      op: 'setEventArchived',
      table: 'events',
      kind: 'update',
      tenantId: tenant.id,
      extra: { eventId: parsedEventId.data, archived: input.archived },
    })
    return {
      error: await translateDbError(
        'setEventArchived: update failed',
        error,
        'eventConfig.genericSaveError',
        {},
        { log: false }
      ),
    }
  }

  if (data.length === 0) return {}

  revalidatePath('/[tenantSlug]/admin', 'page')
  revalidatePath(adminEventRoutePattern('dashboard'), 'page')
  revalidatePath(adminEventRoutePattern('event'), 'page')
  revalidatePath('/[tenantSlug]/events', 'page')

  // The status is read by the cached event config, event info and dashboard
  // summaries, as for publishEvent.
  updateTag(eventInfoCacheTag(tenant.id))
  updateTag(adminEventCacheTag(tenant.id))
  updateTag(adminDashboardCacheTag(tenant.id))

  return {}
}
