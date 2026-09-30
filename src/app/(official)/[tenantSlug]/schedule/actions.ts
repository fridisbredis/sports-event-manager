'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'

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
    return { error: 'Not authorized' }
  }

  const { tenantSlug, todoId, workstationId, timeslotStart, timeslotEnd, checked } = parsed.data

  const user = await getCurrentUser()
  if (!user) return { error: 'Not authorized' }

  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant) return { error: 'Not authorized' }

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
  try {
    const { data: official, error: nameError } = await supabase
      .from('officials')
      .select('name')
      .eq('tenant_id', tenant.id)
      .eq('user_id', user.id)
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
  revalidatePath(`/${tenantSlug}/schedule`)

  return {}
}
