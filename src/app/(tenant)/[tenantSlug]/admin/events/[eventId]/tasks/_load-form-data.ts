import { notFound } from 'next/navigation'
import type { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Stage } from '../workstations/_utils'
import type { AssignableOfficial } from './_components/task-form'
import type { ColorTakenBy } from '../workstations/_components/color-picker'

type SupabaseClient = Awaited<ReturnType<typeof createSupabaseServerClient>>

export interface TaskFormData {
  stages: Stage[]
  officials: AssignableOfficial[]
  takenByStage: Record<string, ColorTakenBy[]>
}

/**
 * What both the create and the edit page need: the event's stages, the
 * officials a task can be given to (confirmed members of this event — the
 * same rule save_task enforces), and the colours other tasks already hold on
 * each stage. `excludeTaskId` leaves the task being edited out of the latter.
 */
export async function loadTaskFormData(
  supabase: SupabaseClient,
  tenantId: string,
  eventId: string,
  excludeTaskId: string | null
): Promise<TaskFormData> {
  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!event) notFound()

  const [stagesRes, officialsRes, colorsRes] = await Promise.all([
    supabase
      .from('event_stages')
      .select('id, name, stage_type, start_time, end_time')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .order('position', { ascending: true }),
    supabase
      .from('officials')
      .select('id, name, official_events!inner(event_id)')
      .eq('tenant_id', tenantId)
      .eq('invite_status', 'confirmed')
      .eq('official_events.event_id', eventId)
      .order('name', { ascending: true }),
    supabase
      .from('tasks')
      .select('id, name, color, stage_id')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .not('color', 'is', null),
  ])

  if (stagesRes.error) throw stagesRes.error
  if (officialsRes.error) throw officialsRes.error
  if (colorsRes.error) throw colorsRes.error

  const takenByStage: Record<string, ColorTakenBy[]> = {}
  for (const task of colorsRes.data ?? []) {
    if (task.id === excludeTaskId || !task.color) continue
    ;(takenByStage[task.stage_id] ??= []).push({ color: task.color, name: task.name })
  }

  return {
    stages: stagesRes.data ?? [],
    officials: (officialsRes.data ?? []).map((o) => ({ id: o.id, name: o.name })),
    takenByStage,
  }
}
