import Link from 'next/link'
import { Bell } from 'lucide-react'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { parsePageParam, pageRange, splitPage } from '@/lib/pagination'
import { EmptyState } from '@/components/ui/empty-state'
import { AnnouncementCard } from '@/components/announcements/announcement-card'
import { formatAnnouncementTime } from '@/lib/i18n/announcement-time'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
  searchParams: Promise<{ page?: string }>
}

export default async function AnnouncementsPage({ params, searchParams }: Props) {
  const { tenantSlug, eventId } = await params
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
    // N23: this event's announcements.
    .eq('event_id', eventId)
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
