'use client'

import { Paperclip } from 'lucide-react'

import { AppCard } from '@/components/ui/app-card'
import { useTranslation } from '@/lib/i18n/client'
import type { OwnFeedback } from '@/lib/feedback/queries'
import { FEEDBACK_TYPE_ICON, FeedbackStatusChip } from './feedback-meta'

interface Props {
  rows: OwnFeedback[]
  /** The read failed: say so, rather than claiming nothing was ever sent. */
  failed?: boolean
}

/**
 * N71: the sender's own feedback with its current status. Read-only — a sent
 * feedback is not edited, and only a system admin changes its status.
 */
export function MyFeedbackList({ rows, failed = false }: Props) {
  const { t, i18n } = useTranslation('common')

  if (failed) {
    return <p className="text-sm text-red-500">{t('feedback.mine.loadFailed')}</p>
  }
  if (rows.length === 0) {
    return <p className="text-sm text-ink-label">{t('feedback.mine.empty')}</p>
  }

  const dateFormat = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' })

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const Icon = FEEDBACK_TYPE_ICON[row.type]
        return (
          <li key={row.id}>
            <AppCard bodyClassName="p-4 md:p-5">
              <div className="flex items-start gap-3">
                <Icon
                  aria-hidden
                  className="mt-0.5 size-5 shrink-0 text-ink-soft"
                  strokeWidth={1.75}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
                      {row.title}
                    </p>
                    <FeedbackStatusChip status={row.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-ink-soft">
                    {row.body}
                  </p>
                  <p className="mt-2 flex items-center gap-2 text-xs text-ink-label">
                    <span>{t(`feedback.type.${row.type}`)}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={row.created_at}>
                      {dateFormat.format(new Date(row.created_at))}
                    </time>
                    {row.image_path && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Paperclip aria-hidden className="size-3.5" strokeWidth={1.75} />
                          {t('feedback.mine.imageAttached')}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
            </AppCard>
          </li>
        )
      })}
    </ul>
  )
}
