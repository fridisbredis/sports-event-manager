import { notFound } from 'next/navigation'

import { requireSystemAdmin } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadFeedbackTriage, TRIAGE_LIMIT } from '@/lib/feedback/triage'
import { FeedbackBoard } from './_components/feedback-board'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// N71: every tenant's feedback in three columns — questions, bug reports,
// feature requests — newest first, with the status the sender sees. Open
// (new + in progress) by default; ?show=all adds done and declined.
export default async function SystemAdminFeedbackPage({ searchParams }: Props) {
  // Each system-admin page guards itself; the layout does not.
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const includeClosed = (await searchParams).show === 'all'
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'common')

  const supabase = await createSupabaseServerClient()
  const { items, failed, truncated } = await loadFeedbackTriage(supabase, { includeClosed })

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
      <h1 className="page-title">{t('feedback.title')}</h1>
      <p className="mb-8 mt-2 max-w-prose text-sm text-ink-muted">{t('feedback.triage.intro')}</p>

      {failed ? (
        <p className="text-sm text-red-500">{t('feedback.triage.loadFailed')}</p>
      ) : (
        <>
          {truncated && (
            <p className="mb-4 text-sm text-status-pending-text">
              {t('feedback.triage.truncated', { count: TRIAGE_LIMIT })}
            </p>
          )}
          <FeedbackBoard items={items} includeClosed={includeClosed} />
        </>
      )}
    </div>
  )
}
