import { AppCard } from '@/components/ui/app-card'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getServerTranslation } from '@/lib/i18n/server'
import { fetchOwnFeedback } from '@/lib/feedback/queries'
import type { FeedbackSurface } from '@/lib/feedback/feedback'
import { FeedbackForm } from './feedback-form'
import { MyFeedbackList } from './my-feedback-list'

interface Props {
  tenantId: string
  userId: string
  language: string
  surface: FeedbackSurface
  eventId?: string | null
  fromPath?: string | null
  /** Admin pages are web-first, official/participant pages mobile-first. */
  layout: 'desktop' | 'mobile'
}

/**
 * N71: the body of the feedback page — heading, the form, and the sender's
 * own feedback with its status. One component for the three surfaces; each
 * route is a thin page that resolves its tenant and renders this.
 */
export async function FeedbackPageContent({
  tenantId,
  userId,
  language,
  surface,
  eventId = null,
  fromPath = null,
  layout,
}: Props) {
  const t = await getServerTranslation(language, 'common')
  const supabase = await createSupabaseServerClient()
  const { rows, failed } = await fetchOwnFeedback(supabase, userId, tenantId)

  const isDesktop = layout === 'desktop'

  return (
    <div className={isDesktop ? 'max-w-3xl px-4 py-6 md:px-8 md:py-8' : 'px-5 pb-10 pt-10'}>
      <h1 className="page-title">{t('feedback.title')}</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">{t('feedback.intro')}</p>

      <AppCard className="mt-6" bodyClassName={isDesktop ? 'p-6 md:p-8' : 'p-5'}>
        <FeedbackForm tenantId={tenantId} eventId={eventId} surface={surface} fromPath={fromPath} />
      </AppCard>

      <h2 className={`section-label ${isDesktop ? 'mb-3.5 mt-10' : 'mb-2.5 mt-8'}`}>
        {t('feedback.mine.title')}
      </h2>
      <MyFeedbackList rows={rows} failed={failed} />
    </div>
  )
}
