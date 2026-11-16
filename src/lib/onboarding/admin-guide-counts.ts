import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export async function fetchAdminGuideCounts(
  supabase: SupabaseClient,
  tenantId: string,
  eventId: string
): Promise<{ workAreaCount: number; assignedShiftCount: number }> {
  const [workAreas, assignments] = await Promise.all([
    supabase
      .from('workstations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('event_id', eventId),
    supabase
      .from('assignments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('event_id', eventId)
      .eq('status', 'assigned'),
  ])

  if (workAreas.error) throw workAreas.error
  if (assignments.error) throw assignments.error

  return {
    workAreaCount: workAreas.count ?? 0,
    assignedShiftCount: assignments.count ?? 0,
  }
}
