import Link from 'next/link'
import { Bell } from 'lucide-react'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { parsePageParam, pageRange, splitPage } from '@/lib/pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { AnnouncementCard } from './_components/announcement-card'
import { DATE_LOCALE } from '@/lib/i18n/date-locale'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ page?: string }>
}

function formatAnnouncementTime(ts: string): string {
  const date = new Date(ts)
  const todayUTC = new Date().toISOString().slice(0, 10)
  const tsUTC = date.toISOString().slice(0, 10)
  const yesterdayUTC = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const time = date.toLocaleTimeString(DATE_LOCALE, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  if (tsUTC === todayUTC) return `Today · ${time}`
  if (tsUTC === yesterdayUTC) return `Yesterday · ${time}`
  const weekday = date.toLocaleDateString(DATE_LOCALE, { weekday: 'short', timeZone: 'UTC' })
  return `${weekday} · ${time}`
}

export default async function AnnouncementsPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { page: pageParam } = await searchParams
  const page = parsePageParam(pageParam)
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // Paged rather than capped (PERF-06): announcements only accumulate, and a
  // bare row ceiling would silently hide the oldest ones from someone
  // browsing. The range asks for one row past the page so `hasMore` needs no
  // second count query.
  const { from, to } = pageRange(page)

  const { data: announcements, error } = await supabase
    .from('announcements')
    .select('id, body, published_at')
    .eq('tenant_id', tenant.id)
    .eq('channel', 'officials')
    .order('published_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  const { items, hasMore } = splitPage(announcements ?? [])
  const isFirstPage = page === 1

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('announcements.title')}</h1>

      {items.length > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            {items.map((a) => (
              <AnnouncementCard
                key={a.id}
                time={formatAnnouncementTime(a.published_at)}
                body={a.body}
              />
            ))}
          </div>

          {(!isFirstPage || hasMore) && (
            <nav className="flex items-center justify-between gap-3 mt-6">
              {isFirstPage ? (
                <span />
              ) : (
                <Link href={`?page=${page - 1}`} className="text-sm font-medium text-primary py-2">
                  {t('announcements.newer')}
                </Link>
              )}
              {hasMore && (
                <Link href={`?page=${page + 1}`} className="text-sm font-medium text-primary py-2">
                  {t('announcements.older')}
                </Link>
              )}
            </nav>
          )}
        </>
      ) : isFirstPage ? (
        <EmptyState
          Icon={Bell}
          title={t('announcements.noAnnouncements')}
          description={t('announcements.noAnnouncementsDescription')}
        />
      ) : (
        // Past the end of the list — a bookmarked or hand-edited ?page= — which
        // is not the same as having no announcements at all.
        <EmptyState Icon={Bell} title={t('announcements.noOlderAnnouncements')}>
          <Link href="?page=1" className="text-sm font-medium text-primary">
            {t('announcements.backToNewest')}
          </Link>
        </EmptyState>
      )}
    </div>
  )
}
