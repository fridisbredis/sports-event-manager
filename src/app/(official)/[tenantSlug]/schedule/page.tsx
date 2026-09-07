import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { ScheduleView, type AssignmentRow } from './_components/schedule-view'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function SchedulePage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'official')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // officialId comes from getOfficialTenant's access check (F-PERF-07-style
  // dedup): it already ran this exact lookup under the service client to
  // decide access, so the page doesn't repeat it with the RLS client.
  const officialId = tenant.officialId

  let assignments: AssignmentRow[] = []

  if (officialId) {
    const { data, error: assignmentsError } = await supabase
      .from('assignments')
      .select(
        `
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
      `
      )
      .eq('official_id', officialId)
      .eq('tenant_id', tenant.id)
      .eq('status', 'assigned')
      .not('workstation_id', 'is', null)
      .order('timeslot_start')

    // An official seeing "no assignments" must mean they have none, not that
    // the query failed — this is the screen they open on event day.
    if (assignmentsError) throw assignmentsError

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
