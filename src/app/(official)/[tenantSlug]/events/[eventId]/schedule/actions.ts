'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { officialEventRoutePattern } from '@/lib/events/paths'

// The shift a check belongs to. Not an assignment id: a check is shared by
// every official on the shift, so there is no single assignment row that owns
// it — see migration 20260930084957's header for the full reasoning.
const toggleSchema = z.object({
  tenantSlug: z.string().min(1),
  todoId: z.string().uuid(),
  workstationId: z.string().uuid(),
  timeslotStart: z.string().datetime({ offset: true }),
  timeslotEnd: z.string().datetime({ offset: true }),
  checked: z.boolean(),
})

export type ToggleChecklistItemInput = z.input<typeof toggleSchema>
export type ToggleChecklistItemResult = { error?: string }

/**
 * Ticks or unticks one checklist item for one shift, and records who did it.
 *
 * Authorisation is enforced twice, per the project's defense-in-depth rule:
 * RLS gates the write at the database (via is_on_workstation_shift), and this
 * action independently re-checks that the caller may see this tenant's
 * official surfaces at all. The RLS policy is the tighter of the two — it is
 * what proves the caller is on *this* shift — so this layer deliberately does
 * not try to duplicate that query, only to fail fast and give a readable
 * message instead of a raw Postgres error.
 */
export async function toggleChecklistItem(
  input: ToggleChecklistItemInput
): Promise<ToggleChecklistItemResult> {
  const parsed = toggleSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn('toggleChecklistItem: invalid input', { issues: parsed.error.issues })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  const { tenantSlug, todoId, workstationId, timeslotStart, timeslotEnd, checked } = parsed.data

  const user = await getCurrentUser()
  if (!user) return { error: await tError('actionErrors.notAuthorized') }

  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const supabase = await createSupabaseServerClient()

  // Wall-clock UTC at the DB boundary, matching the project's timestamp
  // convention — the values arrive as ISO strings from timestamptz columns
  // the page already read, and normalising here keeps the unique index
  // matching on exactly the same text the check was written with.
  const startIso = new Date(timeslotStart).toISOString()
  const endIso = new Date(timeslotEnd).toISOString()

  if (checked) {
    // Upsert on the unique (todo, workstation, shift) index rather than
    // insert: two colleagues tapping the same box at the same moment must
    // produce one row and two happy responses, not a duplicate-key error for
    // whoever lost the race.
    const { error } = await supabase.from('checklist_item_checks').upsert(
      {
        tenant_id: tenant.id,
        todo_id: todoId,
        workstation_id: workstationId,
        timeslot_start: startIso,
        timeslot_end: endIso,
        checked_by: user.id,
        checked_at: new Date().toISOString(),
      },
      { onConflict: 'todo_id,workstation_id,timeslot_start,timeslot_end' }
    )

    if (error) {
      logger.error('toggleChecklistItem: check failed', error, {
        tenantId: tenant.id,
        todoId,
        workstationId,
      })
      return { error: 'checklist.saveFailed' }
    }
  } else {
    const { error } = await supabase
      .from('checklist_item_checks')
      .delete()
      .eq('todo_id', todoId)
      .eq('workstation_id', workstationId)
      .eq('timeslot_start', startIso)
      .eq('timeslot_end', endIso)

    if (error) {
      logger.error('toggleChecklistItem: uncheck failed', error, {
        tenantId: tenant.id,
        todoId,
        workstationId,
      })
      return { error: 'checklist.saveFailed' }
    }
  }

  // The audit row is written after the state change has already succeeded,
  // and its failure never fails the caller — the same fail-safe contract
  // logAuditEvent documents for audit_events. It is NOT written through
  // logAuditEvent: that helper targets `audit_events`, whose actor_role
  // CHECK admits only admins and whose SELECT policies exclude officials.
  //
  // actor_name is denormalised here so the trail survives the actor's
  // auth.users row being deleted (which nulls actor_user_id) and renders
  // without a join. A null name degrades to the UI's "someone" fallback
  // rather than blocking the write.
  //
  // Removal is a soft delete, so a re-invited official holds both a 'removed'
  // and a 'confirmed' row for this (tenant, user) — migration 0020 permits it.
  // Without the status filter and limit(1), maybeSingle() turns that into
  // PGRST116 and every tick they make is audited as "someone" (Sentry
  // VIADAL-EVENT-PROD-6). Same shape as the guard in canViewOfficialSurfaces.
  try {
    const { data: official, error: nameError } = await supabase
      .from('officials')
      .select('name')
      .eq('tenant_id', tenant.id)
      .eq('user_id', user.id)
      .eq('invite_status', 'confirmed')
      .limit(1)
      .maybeSingle()

    // Never fatal — the audit row is worth more with a null name than not
    // written at all — but logged rather than swallowed (F-REL-10), since a
    // trail that silently loses every name is a trail nobody can act on.
    if (nameError) {
      logger.error('toggleChecklistItem: actor name lookup failed', nameError, {
        tenantId: tenant.id,
        todoId,
      })
    }

    const { error: auditError } = await supabase.from('checklist_item_events').insert({
      tenant_id: tenant.id,
      todo_id: todoId,
      workstation_id: workstationId,
      timeslot_start: startIso,
      timeslot_end: endIso,
      actor_user_id: user.id,
      actor_name: official?.name ?? null,
      action: checked ? 'checked' : 'unchecked',
    })

    if (auditError) {
      logger.error('toggleChecklistItem: audit write failed', auditError, {
        tenantId: tenant.id,
        todoId,
        action: checked ? 'checked' : 'unchecked',
      })
    }
  } catch (err) {
    logger.error('toggleChecklistItem: audit write threw', err, {
      tenantId: tenant.id,
      todoId,
    })
  }

  // MYSCH-01 is ADR-0003 Group 2 (uncached) — revalidatePath is what pushes
  // a colleague's tick to the other officials on the shift on their next
  // navigation, since there is no cache tag to update here.
  revalidatePath(officialEventRoutePattern('schedule'), 'page')

  return {}
}

// ---------------------------------------------------------------------------
// N72: an assigned official's own tasks
// ---------------------------------------------------------------------------
// Both writes go through SECURITY DEFINER RPCs (migration 20261127105240) that
// check the caller is a confirmed assignee of the task, write the flag and the
// task_events trail row in one transaction, and record who ticked it. This
// action only fails fast on a caller who cannot see the tenant's official
// surfaces at all — the RPC is the tighter check, as RLS is for the shift
// checklist above.

const taskToggleSchema = z.object({
  tenantSlug: z.string().min(1),
  id: z.string().uuid(),
  checked: z.boolean(),
})

export type ToggleMyTaskInput = z.input<typeof taskToggleSchema>

async function runTaskToggle(
  label: string,
  input: ToggleMyTaskInput,
  rpc: 'set_task_done' | 'set_task_todo_checked'
): Promise<ToggleChecklistItemResult> {
  const parsed = taskToggleSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn(`${label}: invalid input`, { issues: parsed.error.issues })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  const user = await getCurrentUser()
  if (!user) return { error: await tError('actionErrors.notAuthorized') }

  const tenant = await getOfficialTenant(parsed.data.tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const supabase = await createSupabaseServerClient()
  const { error } =
    rpc === 'set_task_done'
      ? await supabase.rpc('set_task_done', {
          p_task_id: parsed.data.id,
          p_done: parsed.data.checked,
        })
      : await supabase.rpc('set_task_todo_checked', {
          p_todo_id: parsed.data.id,
          p_checked: parsed.data.checked,
        })

  if (error) {
    logger.error(`${label}: ${rpc} failed`, error, { tenantId: tenant.id, id: parsed.data.id })
    return { error: 'checklist.saveFailed' }
  }

  // Uncached screen (ADR-0003 Group 2): this is what shows a co-assignee's
  // tick on their next navigation.
  revalidatePath(officialEventRoutePattern('schedule'), 'page')
  return {}
}

/** Ticks or unticks one of the caller's tasks as done. */
export async function toggleMyTaskDone(
  input: ToggleMyTaskInput
): Promise<ToggleChecklistItemResult> {
  return runTaskToggle('toggleMyTaskDone', input, 'set_task_done')
}

/** Ticks or unticks a checklist item on one of the caller's tasks. */
export async function toggleMyTaskTodo(
  input: ToggleMyTaskInput
): Promise<ToggleChecklistItemResult> {
  return runTaskToggle('toggleMyTaskTodo', input, 'set_task_todo_checked')
}
