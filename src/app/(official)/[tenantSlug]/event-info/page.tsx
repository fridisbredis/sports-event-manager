import { redirect, notFound } from 'next/navigation'
import Image from 'next/image'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getServerTranslation } from '@/lib/i18n/server'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

function formatDate(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

function formatTime(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3">
      {children}
    </p>
  )
}

function LogoPlaceholder({ size }: { size: number }) {
  return (
    <div
      style={{ width: size, height: size }}
      className="shrink-0 rounded-lg border border-gray-200 bg-gray-100 flex items-center justify-center"
    >
      <svg viewBox="0 0 24 24" className="w-1/2 h-1/2 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M3 21L21 3" />
        <rect x="3" y="3" width="18" height="18" rx="1" />
      </svg>
    </div>
  )
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

  const stagesWithVenue = (stages ?? []).filter((s) => s.venue)

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('eventInfo.title')}</h1>

      {/* Identity */}
      <div className="mb-8">
        <div className="flex items-start gap-4 mb-3">
          {event?.logo_url ? (
            <Image
              src={event.logo_url}
              alt={event.name}
              width={72}
              height={72}
              className="rounded-lg object-cover shrink-0"
            />
          ) : (
            <LogoPlaceholder size={72} />
          )}
          <div className="min-w-0">
            <p className="text-lg font-bold text-gray-900 leading-snug">{event?.name ?? '—'}</p>
            <p className="text-sm text-gray-500 mt-0.5">{event?.event_type ?? ''}</p>
          </div>
        </div>
        {event?.description ? (
          <p className="text-sm text-gray-600 leading-relaxed">{event.description}</p>
        ) : null}
      </div>

      {/* Dates by stage */}
      {(stages ?? []).length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.datesByStage')}</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {(stages ?? []).map((stage) => (
              <p key={stage.id} className="text-sm text-gray-900">
                Stage {stage.position} · {stage.name}
                {stage.start_time ? ` — ${formatDate(stage.start_time)}` : ''}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {/* Location & venue per stage */}
      {stagesWithVenue.length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.locationAndVenue')}</SectionLabel>
          <div className="flex items-start gap-4">
            <LogoPlaceholder size={120} />
            <div className="flex flex-col gap-1.5 pt-1">
              {stagesWithVenue.map((stage) => (
                <p key={stage.id} className="text-sm text-gray-900">
                  Stage {stage.position} · {stage.venue}
                </p>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Facilities */}
      {(facilities ?? []).length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.facilities')}</SectionLabel>
          <p className="text-sm text-gray-900">
            {(facilities ?? []).map((f) => f.label).join(' · ')}
          </p>
        </div>
      ) : null}

      {/* Event programme by stage */}
      {(stages ?? []).length > 0 ? (
        <div className="mb-8">
          <SectionLabel>{t('eventInfo.programme')}</SectionLabel>
          <div className="flex flex-col gap-1.5">
            {(stages ?? []).map((stage) => {
              const start = formatTime(stage.start_time)
              const end = formatTime(stage.end_time)
              const times = [start, end].filter(Boolean).join(' – ')
              return (
                <p key={stage.id} className="text-sm text-gray-900">
                  Stage {stage.position} · {stage.name}
                  {times ? ` · ${times}` : ''}
                </p>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}
