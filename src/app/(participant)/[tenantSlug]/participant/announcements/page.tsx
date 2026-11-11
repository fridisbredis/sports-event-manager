import Link from 'next/link'
import { Bell } from 'lucide-react'
import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { parsePageParam } from '@/lib/pagination'
import { formatAnnouncementTime } from '@/lib/i18n/announcement-time'
import { loadParticipantAnnouncements } from '@/lib/participants/participant-announcements'
import { EmptyState } from '@/components/ui/empty-state'
import { AnnouncementCard } from '@/components/announcements/announcement-card'
import { NotAvailable } from '../_components/not-available'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ page?: string }>
}

// N44: ANN-02, the participant channel's timeline. Read-only, newest first,
// paged like the official Announcements page (PERF-06). The strings are the
// official screen's: the same words for the same thing.
export default async function ParticipantAnnouncementsPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { page: pageParam } = await searchParams
  const page = parsePageParam(pageParam)
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  const tenant = await getParticipantTenant(tenantSlug)

  if (!tenant) notFound()

  const result = await loadParticipantAnnouncements(tenant, page)

  return (
    <div className="px-5 pt-10 pb-6">
      <h1 className="page-title mb-6">{t('announcements.title')}</h1>

      {!result.open ? (
        <NotAvailable message={t('participant.home.notAvailable')} />
      ) : result.items.length > 0 ? (
        <>
          <div className="flex flex-col gap-3">
            {result.items.map((a) => {
              const time = formatAnnouncementTime(a.publishedAt, language, t)
              return (
                <AnnouncementCard
                  key={a.id}
                  time={a.eventName ? `${a.eventName} · ${time}` : time}
                  body={a.body}
                />
              )
            })}
          </div>

          {(page > 1 || result.hasMore) && (
            <nav className="mt-6 flex items-center justify-between gap-3">
              {page === 1 ? (
                <span />
              ) : (
                <Link href={`?page=${page - 1}`} className="py-2 text-sm font-medium text-primary">
                  {t('announcements.newer')}
                </Link>
              )}
              {result.hasMore && (
                <Link href={`?page=${page + 1}`} className="py-2 text-sm font-medium text-primary">
                  {t('announcements.older')}
                </Link>
              )}
            </nav>
          )}
        </>
      ) : page === 1 ? (
        <EmptyState
          Icon={Bell}
          title={t('announcements.noAnnouncements')}
          description={t('announcements.noAnnouncementsDescription')}
        />
      ) : (
        <EmptyState Icon={Bell} title={t('announcements.noOlderAnnouncements')}>
          <Link href="?page=1" className="text-sm font-medium text-primary">
            {t('announcements.backToNewest')}
          </Link>
        </EmptyState>
      )}
    </div>
  )
}
