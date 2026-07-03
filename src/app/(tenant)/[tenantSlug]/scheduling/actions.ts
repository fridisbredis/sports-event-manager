'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

export interface AssignmentInput {
  official_id: string
  workstation_id: string
  timeslot_start: string
  timeslot_end: string
}

export interface SaveAssignmentsResult {
  error?: string
  inserted?: { id: string; official_id: string; workstation_id: string | null; timeslot_start: string }[]
}

export async function saveAssignments(
  tenantSlug: string,
  tenantId: string,
  additions: AssignmentInput[],
  deletions: string[]
): Promise<SaveAssignmentsResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!roleRow || (roleRow.role !== 'tenant_admin' && roleRow.role !== 'system_admin')) {
    return { error: 'Not authorized' }
  }

  if (deletions.length > 0) {
    const { error } = await supabase
      .from('assignments')
      .delete()
      .in('id', deletions)
      .eq('tenant_id', tenantId)

    if (error) return { error: error.message }
  }

  let inserted: SaveAssignmentsResult['inserted'] = []

  if (additions.length > 0) {
    // Fetch existing slot_indexes for all affected (workstation, timeslot) pairs
    // so we can assign the lowest free slot_index per pair (including within the batch).
    const wsIds = [...new Set(additions.map((a) => a.workstation_id))]
    const { data: existing } = await supabase
      .from('assignments')
      .select('workstation_id, timeslot_start, slot_index')
      .in('workstation_id', wsIds)
      .eq('tenant_id', tenantId)

    const usedSlots = new Map<string, Set<number>>()
    for (const row of existing ?? []) {
      if (row.slot_index === null) continue
      // Normalize timestamptz → ISO string for consistent map keys
      const key = `${row.workstation_id}|${new Date(row.timeslot_start).toISOString()}`
      const set = usedSlots.get(key) ?? new Set()
      set.add(row.slot_index)
      usedSlots.set(key, set)
    }

    function nextFreeSlot(wsId: string, slotStart: string): number {
      const key = `${wsId}|${slotStart}`
      const used = usedSlots.get(key) ?? new Set<number>()
      let slot = 1
      while (used.has(slot)) slot++
      used.add(slot)
      usedSlots.set(key, used)
      return slot
    }

    const { data, error } = await supabase
      .from('assignments')
      .insert(
        additions.map((a) => ({
          tenant_id: tenantId,
          official_id: a.official_id,
          workstation_id: a.workstation_id,
          timeslot_start: a.timeslot_start,
          timeslot_end: a.timeslot_end,
          slot_index: nextFreeSlot(a.workstation_id, a.timeslot_start),
          status: 'assigned' as const,
        }))
      )
      .select('id, official_id, workstation_id, timeslot_start')

    if (error) return { error: error.message }
    inserted = data ?? []
  }

  revalidatePath(`/${tenantSlug}/scheduling`)

  return { inserted }
}
