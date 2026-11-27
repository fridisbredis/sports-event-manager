'use client'

import Link from 'next/link'
import { ChevronRight, MessageSquareText } from 'lucide-react'

import { CARD_SURFACE } from '@/components/ui/card-styles'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  href: string
  /** Bottom margin, matching the surrounding cards on the account screen. */
  className?: string
}

/**
 * N71: the way into Feedback for officials and participants. Their tab bars
 * are full, so it sits on the account page as one more card in the same
 * shape as "Change event" and "My shifts" there.
 */
export function FeedbackLinkCard({ href, className = 'mb-8' }: Props) {
  const { t } = useTranslation('common')
  return (
    <>
      <p className="section-label mb-2.5">{t('feedback.title')}</p>
      <Link
        href={href}
        className={`flex items-center gap-4 ${CARD_SURFACE} ${className} px-4 py-4 transition-colors hover:bg-surface`}
      >
        <MessageSquareText
          aria-hidden="true"
          strokeWidth={1.7}
          className="size-8 shrink-0 text-tenant-primary"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">{t('feedback.link.title')}</p>
          <p className="mt-0.5 text-sm text-ink-muted">{t('feedback.link.sub')}</p>
        </div>
        <ChevronRight
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-5 shrink-0 text-ink-label"
        />
      </Link>
    </>
  )
}
