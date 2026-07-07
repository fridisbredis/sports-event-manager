import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getServerTranslation } from '@/lib/i18n/server'
import { ScheduleView, type AssignmentRow } from './_components/schedule-view'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function SchedulePage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'official')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  const service = await createSupabaseServiceClient()

  const { data: officialsRows } = await service
    .from('officials')
    .select('id')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .eq('invite_status', 'confirmed')
    .limit(1)

  const official = officialsRows?.[0] ?? null

  let assignments: AssignmentRow[] = []

  if (official) {
    const { data } = await service
      .from('assignments')
      .select(`
        id,
        timeslot_start,
        timeslot_end,
        status,
        workstations (
          id,
          name,
          description,
          workstation_todos ( id, instruction_text, position )
        )
      `)
      .eq('official_id', official.id)
      .eq('tenant_id', tenant.id)
      .eq('status', 'assigned')
      .not('workstation_id', 'is', null)
      .order('timeslot_start')

    assignments = (data ?? []) as AssignmentRow[]
  }

  const strings = {
    title: t('mySchedule.title'),
    readOnly: t('mySchedule.readOnly'),
    byTime: t('mySchedule.byTime'),
    byWorkstation: t('mySchedule.byWorkstation'),
    noAssignments: t('mySchedule.noAssignments'),
    noAssignmentsDescription: t('mySchedule.noAssignmentsDescription'),
  }

  return <ScheduleView assignments={assignments} strings={strings} />
}
