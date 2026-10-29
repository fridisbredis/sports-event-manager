'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminTenant } from '@/lib/auth/tenant'
import { maxActiveEvents } from '@/lib/tiers/features'
import { logQueryError } from '@/lib/db/query-error'
import { translateDbError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { COPY_OPTIONS, type CopyOption } from '@/lib/events/copy-options'

const inputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sourceEventId: z.string().uuid().nullable(),
  copy: z
    .object(Object.fromEntries(COPY_OPTIONS.map((key) => [key, z.boolean().optional()])))
    .strict(),
  // Source stage id -> the copied stage's new date.
  stageDates: z.record(z.string().uuid(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
})

export interface CreateEventInput {
  tenantSlug: string
  name: string
  sourceEventId: string | null
  copy: Partial<Record<CopyOption, boolean>>
  stageDates: Record<string, string>
}

export type CreateEventResult = { eventId: string; error?: never } | { error: string }

// N23 / TEN-01: a new event, blank or copied from another of the tenant's
// events. Everything happens in create_event, one transaction (REL-01): the
// event, its stages with their new dates, and whatever else was ticked. The
// RPC runs as the caller, so RLS is the database's check and getAdminTenant
// the app's; the tier cap is enforced by the events_enforce_cap trigger,
// whose P0001 this turns into a message.
export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const tenant = await getAdminTenant(input.tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) return { error: await tError('actionErrors.invalidRequest') }
  const { name, sourceEventId, copy, stageDates } = parsed.data

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('create_event', {
    p_tenant_id: tenant.id,
    p_name: name,
    // Nullable in SQL; the generated types cannot express that for an RPC
    // argument.
    p_source_event_id: sourceEventId as string,
    p_copy: copy,
    p_stage_dates: stageDates,
  })

  if (error) {
    // The ordinary "no free slot" answer, not a failure worth a log line.
    if (error.code === 'P0001') {
      const key =
        maxActiveEvents(tenant.tier) === 1
          ? 'actionErrors.createEventArchiveFirst'
          : 'actionErrors.createEventUpgrade'
      return { error: await tError(key) }
    }

    logQueryError(error, {
      op: 'createEvent',
      table: 'events',
      kind: 'rpc',
      tenantId: tenant.id,
      extra: { sourceEventId, copy },
    })
    return {
      error: await translateDbError(
        'createEvent: create_event failed',
        error,
        'eventConfig.genericSaveError',
        {},
        { log: false }
      ),
    }
  }

  revalidatePath('/[tenantSlug]/admin', 'page')

  return { eventId: (data as { event_id: string }).event_id }
}
