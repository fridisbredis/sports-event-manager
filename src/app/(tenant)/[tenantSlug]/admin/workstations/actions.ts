'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'

export interface WindowInput {
  window_start: string
  window_end: string
}

export interface CreateWorkstationInput {
  tenantSlug: string
  tenantId: string
  eventId: string
  stageId: string | null
  name: string
  description: string
  capacity: number
  recurring: boolean
  windows: WindowInput[]
  todos: string[]
}

export interface CreateWorkstationResult {
  error?: string
}

export async function createWorkstation(
  input: CreateWorkstationInput
): Promise<CreateWorkstationResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, input.tenantId))) return { error: 'Not authorized' }

  const service = await createSupabaseServiceClient()

  const { data: ws, error: wsError } = await supabase
    .from('workstations')
    .insert({
      tenant_id: input.tenantId,
      event_id: input.eventId,
      stage_id: input.stageId,
      name: input.name.trim(),
      description: input.description.trim() || null,
      capacity_ceiling: input.capacity,
      recurring: input.recurring,
    })
    .select('id')
    .single()

  if (wsError || !ws) return { error: wsError?.message ?? 'Failed to create work area' }

  const validWindows = input.windows.filter((w) => w.window_start && w.window_end)
  if (validWindows.length > 0) {
    const { error: winError } = await supabase.from('workstation_operating_windows').insert(
      validWindows.map((w) => ({
        workstation_id: ws.id,
        window_start: w.window_start,
        window_end: w.window_end,
      }))
    )
    if (winError) return { error: winError.message }
  }

  const validTodos = input.todos.map((t, i) => t.trim()).filter(Boolean)
  if (validTodos.length > 0) {
    const { error: todoError } = await supabase.from('workstation_todos').insert(
      validTodos.map((text, i) => ({
        workstation_id: ws.id,
        instruction_text: text,
        position: i,
      }))
    )
    if (todoError) return { error: todoError.message }
  }

  revalidatePath(`/${input.tenantSlug}/admin/workstations`)

  return {}
}

export interface UpdateWorkstationInput {
  tenantSlug: string
  tenantId: string
  workstationId: string
  stageId: string | null
  name: string
  description: string
  capacity: number
  recurring: boolean
  windows: WindowInput[]
  todos: string[]
}

export interface UpdateWorkstationResult {
  error?: string
}

export async function updateWorkstation(
  input: UpdateWorkstationInput
): Promise<UpdateWorkstationResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, input.tenantId))) return { error: 'Not authorized' }

  const service = await createSupabaseServiceClient()

  const { error: wsError } = await supabase
    .from('workstations')
    .update({
      stage_id: input.stageId,
      name: input.name.trim(),
      description: input.description.trim() || null,
      capacity_ceiling: input.capacity,
      recurring: input.recurring,
    })
    .eq('id', input.workstationId)
    .eq('tenant_id', input.tenantId)

  if (wsError) return { error: wsError.message }

  const { error: delWinError } = await supabase
    .from('workstation_operating_windows')
    .delete()
    .eq('workstation_id', input.workstationId)

  if (delWinError) return { error: delWinError.message }

  const validWindows = input.windows.filter((w) => w.window_start && w.window_end)
  if (validWindows.length > 0) {
    const { error: winError } = await supabase.from('workstation_operating_windows').insert(
      validWindows.map((w) => ({
        workstation_id: input.workstationId,
        window_start: w.window_start,
        window_end: w.window_end,
      }))
    )
    if (winError) return { error: winError.message }
  }

  const { error: delTodoError } = await supabase
    .from('workstation_todos')
    .delete()
    .eq('workstation_id', input.workstationId)

  if (delTodoError) return { error: delTodoError.message }

  const validTodos = input.todos.map((t) => t.trim()).filter(Boolean)
  if (validTodos.length > 0) {
    const { error: todoError } = await supabase.from('workstation_todos').insert(
      validTodos.map((text, i) => ({
        workstation_id: input.workstationId,
        instruction_text: text,
        position: i,
      }))
    )
    if (todoError) return { error: todoError.message }
  }

  revalidatePath(`/${input.tenantSlug}/admin/workstations`)

  return {}
}

export interface DeleteWorkstationInput {
  tenantSlug: string
  tenantId: string
  workstationId: string
}

export interface DeleteWorkstationResult {
  error?: string
}

export async function deleteWorkstation(
  input: DeleteWorkstationInput
): Promise<DeleteWorkstationResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, input.tenantId))) return { error: 'Not authorized' }

  const service = await createSupabaseServiceClient()

  const { error } = await supabase
    .from('workstations')
    .delete()
    .eq('id', input.workstationId)
    .eq('tenant_id', input.tenantId)

  if (error) return { error: error.message }

  revalidatePath(`/${input.tenantSlug}/admin/workstations`)

  return {}
}
