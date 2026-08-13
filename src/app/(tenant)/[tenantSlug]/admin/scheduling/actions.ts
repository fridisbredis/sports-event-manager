'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'

const tenantIdSchema = z.string().uuid()

export interface AssignmentInput {
  official_id: string
  workstation_id: string
  timeslot_start: string
  timeslot_end: string
  slot_index?: number
}

export interface StatusUpdate {
  id: string
  status: string
}

export interface SaveAssignmentsResult {
  error?: string
  inserted?: {
    id: string
    official_id: string
    workstation_id: string | null
    timeslot_start: string
    slot_index: number | null
  }[]
}

export async function saveAssignments(
  tenantSlug: string,
  tenantId: string,
  additions: AssignmentInput[],
  deletions: string[],
  statusUpdates: StatusUpdate[] = []
): Promise<SaveAssignmentsResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(tenantId)
  if (!parsedTenantId.success) {
    console.error('saveAssignments: invalid tenantId', tenantId)
    return { error: 'Not authorized' }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: 'Not authorized' }

  if (deletions.length > 0) {
    const { error } = await supabase
      .from('assignments')
      .delete()
      .in('id', deletions)
      .eq('tenant_id', parsedTenantId.data)

    if (error) return { error: error.message }
  }

  if (statusUpdates.length > 0) {
    for (const { id, status } of statusUpdates) {
      const { error } = await supabase
        .from('assignments')
        .update({ status })
        .eq('id', id)
        .eq('tenant_id', parsedTenantId.data)
      if (error) return { error: error.message }
    }
  }

  let inserted: SaveAssignmentsResult['inserted'] = []

  if (additions.length > 0) {
    // Check every workstation touched by this save, not just the auto-assign
    // additions — explicit slot_index picks (from the expanded lane view) can
    // just as easily collide with a slot someone else took after this admin's
    // page loaded.
    const wsIds = [...new Set(additions.map((a) => a.workstation_id))]

    const usedSlots = new Map<string, Set<number>>()

    if (wsIds.length > 0) {
      const { data: existing } = await supabase
        .from('assignments')
        .select('workstation_id, timeslot_start, slot_index')
        .in('workstation_id', wsIds)
        .eq('tenant_id', parsedTenantId.data)

      for (const row of existing ?? []) {
        if (row.slot_index === null) continue
        const key = `${row.workstation_id}|${new Date(row.timeslot_start).toISOString()}`
        const set = usedSlots.get(key) ?? new Set()
        set.add(row.slot_index)
        usedSlots.set(key, set)
      }
    }

    function nextFreeSlot(wsId: string, slotStart: string): number {
      const key = `${wsId}|${new Date(slotStart).toISOString()}`
      const used = usedSlots.get(key) ?? new Set<number>()
      let slot = 1
      while (used.has(slot)) slot++
      used.add(slot)
      usedSlots.set(key, used)
      return slot
    }

    const rows: {
      tenant_id: string
      official_id: string
      workstation_id: string
      timeslot_start: string
      timeslot_end: string
      slot_index: number
      status: 'assigned'
    }[] = []

    for (const a of additions) {
      let slotIndex = a.slot_index
      if (slotIndex !== undefined) {
        const key = `${a.workstation_id}|${new Date(a.timeslot_start).toISOString()}`
        const used = usedSlots.get(key) ?? new Set<number>()
        if (used.has(slotIndex)) {
          return {
            error: 'Someone else just took that slot. Please reload the schedule and try again.',
          }
        }
        used.add(slotIndex)
        usedSlots.set(key, used)
      } else {
        slotIndex = nextFreeSlot(a.workstation_id, a.timeslot_start)
      }

      rows.push({
        tenant_id: parsedTenantId.data,
        official_id: a.official_id,
        workstation_id: a.workstation_id,
        timeslot_start: a.timeslot_start,
        timeslot_end: a.timeslot_end,
        slot_index: slotIndex,
        status: 'assigned',
      })
    }

    const { data, error } = await supabase
      .from('assignments')
      .insert(rows)
      .select('id, official_id, workstation_id, timeslot_start, slot_index')

    if (error) return { error: error.message }
    inserted = data ?? []
  }

  revalidatePath(`/${tenantSlug}/admin/scheduling`)

  return { inserted }
}
