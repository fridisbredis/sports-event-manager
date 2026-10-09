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
import { dateLocaleFor, EVENT_TIME_ZONE } from '@/lib/i18n/date-locale'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ page?: string }>
}

// Takes the translator rather than reaching for one: this is a module-level
// helper with no hook or request scope of its own, and the two relative-day
// labels are UI strings like any other. They were hardcoded English before, so
// a Swedish official reading an otherwise Swedish page saw "Today · 14:30".
//
// published_at is a real instant (the server's `new Date().toISOString()` at
// publish time), not one of the wall-clock-UTC timestamps the scheduling side
// stores — so it is the one kind of timestamp that must be converted rather
// than rendered as-is. It was formatted with `timeZone: 'UTC'`, which showed a
// 15:46 announcement as "13:46" to every official.
//
// The relative-day comparison has to run in the same zone as the clock beside
// it, or a late-evening announcement reads "Yesterday · 23:30" the moment UTC
// rolls over while Stockholm is still on the same day.
function eventDayKey(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: EVENT_TIME_ZONE,
  })
}

function formatAnnouncementTime(ts: string, language: string, t: (key: string) => string): string {
  const date = new Date(ts)
  const locale = dateLocaleFor(language)
  const day = eventDayKey(date, locale)
  const today = eventDayKey(new Date(), locale)
  const yesterday = eventDayKey(new Date(Date.now() - 86_400_000), locale)
  const time = date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: EVENT_TIME_ZONE,
  })
  if (day === today) return `${t('announcements.today')} · ${time}`
  if (day === yesterday) return `${t('announcements.yesterday')} · ${time}`
  const weekday = date.toLocaleDateString(locale, {
    weekday: 'short',
    timeZone: EVENT_TIME_ZONE,
  })
  return `${weekday} · ${time}`
}

export default async function AnnouncementsPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { page: pageParam } = await searchParams
  const page = parsePageParam(pageParam)
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

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
                time={formatAnnouncementTime(a.published_at, language, t)}
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
