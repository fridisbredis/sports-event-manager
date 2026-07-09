import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import WorkstationEditForm from './_components/workstation-edit-form'

interface Props {
  params: Promise<{ tenantSlug: string; workstationId: string }>
}

export default async function EditWorkstationPage({ params }: Props) {
  const { tenantSlug, workstationId } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!event) notFound()

  const [{ data: ws }, { data: stages }] = await Promise.all([
    supabase
      .from('workstations')
      .select(
        'id, name, description, capacity_ceiling, stage_id, recurring, workstation_operating_windows(id, window_start, window_end), workstation_todos(id, instruction_text, position)'
      )
      .eq('id', workstationId)
      .eq('tenant_id', tenant.id)
      .single(),
    supabase
      .from('event_stages')
      .select('id, name, stage_type, start_time, end_time')
      .eq('event_id', event.id)
      .eq('tenant_id', tenant.id)
      .order('position', { ascending: true }),
  ])

  if (!ws) notFound()

  const sortedTodos = [...(ws.workstation_todos ?? [])].sort((a, b) => a.position - b.position)

  return (
    <div className="px-8 py-8">
      <WorkstationEditForm
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        workstationId={ws.id}
        stages={stages ?? []}
        initialStageId={ws.stage_id}
        initialName={ws.name}
        initialDescription={ws.description ?? ''}
        initialCapacity={ws.capacity_ceiling}
        initialWindows={(ws.workstation_operating_windows ?? []).map((w) => ({
          window_start: w.window_start,
          window_end: w.window_end,
        }))}
        initialTodos={sortedTodos.map((t) => t.instruction_text)}
      />
    </div>
  )
}
