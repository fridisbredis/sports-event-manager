import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getServerTranslation } from '@/lib/i18n/server'
import { EventHeaderCard } from './_components/event-header-card'
import { StageCard } from './_components/stage-card'
import { FacilityChips } from './_components/facility-chips'
import { SectionLabel } from './_components/section-label'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

export default async function EventInfoPage({ params }: Props) {
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

  const [{ data: event }, { data: stages }, { data: facilities }] = await Promise.all([
    service
      .from('events')
      .select('name, event_type, description, logo_url, status')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    service
      .from('event_stages')
      .select('id, name, stage_type, start_time, end_time, venue, position')
      .eq('tenant_id', tenant.id)
      .order('position'),
    service
      .from('event_facilities')
      .select('id, label, position')
      .eq('tenant_id', tenant.id)
      .order('position'),
  ])

  const stageList = stages ?? []
  const facilityList = facilities ?? []

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('eventInfo.title')}</h1>

      <EventHeaderCard
        name={event?.name ?? '—'}
        eventType={event?.event_type ?? ''}
        logoUrl={event?.logo_url ?? null}
        description={event?.description ?? null}
      />

      {stageList.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.programme')}</SectionLabel>
          <div className="flex flex-col gap-3">
            {stageList.map((stage) => {
              const timeRange = [formatTime(stage.start_time), formatTime(stage.end_time)]
                .filter(Boolean)
                .join(' – ')
              return (
                <StageCard
                  key={stage.id}
                  stageNumber={stage.position + 1}
                  name={stage.name}
                  date={formatDate(stage.start_time)}
                  timeRange={timeRange}
                  venue={stage.venue}
                />
              )
            })}
          </div>
        </div>
      ) : null}

      {facilityList.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.facilities')}</SectionLabel>
          <FacilityChips facilities={facilityList} />
        </div>
      ) : null}
    </div>
  )
}
