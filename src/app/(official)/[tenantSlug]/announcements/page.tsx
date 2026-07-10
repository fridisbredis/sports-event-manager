import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getServerTranslation } from '@/lib/i18n/server'
import { AnnouncementCard } from './_components/announcement-card'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

function formatAnnouncementTime(ts: string): string {
  const date = new Date(ts)
  const todayUTC = new Date().toISOString().slice(0, 10)
  const tsUTC = date.toISOString().slice(0, 10)
  const yesterdayUTC = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
  if (tsUTC === todayUTC) return `Today · ${time}`
  if (tsUTC === yesterdayUTC) return `Yesterday · ${time}`
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} · ${time}`
}

function EmptyIcon() {
  return (
    <div className="w-20 h-20 rounded-xl border border-gray-200 bg-gray-100 flex items-center justify-center">
      <svg viewBox="0 0 24 24" className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M3 21L21 3" />
        <rect x="3" y="3" width="18" height="18" rx="1" />
      </svg>
    </div>
  )
}

export default async function AnnouncementsPage({ params }: Props) {
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

  const { data: announcements } = await service
    .from('announcements')
    .select('id, body, published_at')
    .eq('tenant_id', tenant.id)
    .eq('channel', 'officials')
    .order('published_at', { ascending: false })

  const items = announcements ?? []

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('announcements.title')}</h1>

      {items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {items.map((a) => (
            <AnnouncementCard key={a.id} time={formatAnnouncementTime(a.published_at)} body={a.body} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center pt-24 gap-4 text-center">
          <EmptyIcon />
          <div>
            <p className="text-base font-semibold text-gray-900">{t('announcements.noAnnouncements')}</p>
            <p className="text-sm text-gray-500 mt-1">{t('announcements.noAnnouncementsDescription')}</p>
          </div>
        </div>
      )}
    </div>
  )
}
