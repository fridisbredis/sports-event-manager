'use client'

import { Bug, Lightbulb, MessageCircleQuestion, type LucideIcon } from 'lucide-react'

import { useTranslation } from '@/lib/i18n/client'
import type { FeedbackStatus, FeedbackType } from '@/types/app'

// N71: what a feedback type and status look like, shared by the sender's page
// and the system admin's triage page so the two never describe the same row
// differently.

export const FEEDBACK_TYPE_ICON: Record<FeedbackType, LucideIcon> = {
  question: MessageCircleQuestion,
  bug: Bug,
  feature: Lightbulb,
}

// The handoff's tenant-independent status colours (tailwind.config.ts
// `status.*`): a status reports state, so it reads the same in every theme.
// Red is kept for errors, so "declined" is a quiet outline rather than a
// danger colour: it is an answer, not a failure.
const STATUS_CLASS: Record<FeedbackStatus, string> = {
  new: 'bg-status-neutral-bg text-status-neutral-text',
  in_progress: 'bg-status-pending-bg text-status-pending-text',
  done: 'bg-status-ok-bg text-status-ok-text',
  declined: 'border border-edge bg-white text-ink-label',
}

export function FeedbackStatusChip({ status }: { status: FeedbackStatus }) {
  const { t } = useTranslation('common')
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASS[status]}`}
    >
      {t(`feedback.status.${status}`)}
    </span>
  )
}
