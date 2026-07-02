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

  if (additions.length > 0) {
    const { error } = await supabase.from('assignments').insert(
      additions.map((a) => ({
        tenant_id: tenantId,
        official_id: a.official_id,
        workstation_id: a.workstation_id,
        timeslot_start: a.timeslot_start,
        timeslot_end: a.timeslot_end,
        status: 'assigned' as const,
      }))
    )

    if (error) return { error: error.message }
  }

  revalidatePath(`/${tenantSlug}/scheduling`)

  return {}
}
