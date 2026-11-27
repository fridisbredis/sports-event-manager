'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import { AppCard } from '@/components/ui/app-card'
import { FEEDBACK_TYPE_ICON, FeedbackStatusChip } from '@/components/feedback/feedback-meta'
import { useTranslation } from '@/lib/i18n/client'
import { EVENT_TIME_ZONE } from '@/lib/i18n/date-locale'
import { toastError } from '@/lib/toast'
import type { TriageItem } from '@/lib/feedback/triage'
import { FEEDBACK_STATUSES, FEEDBACK_TYPES, type FeedbackStatus } from '@/types/app'
import { updateFeedbackStatus } from '../../actions'

interface Props {
  items: TriageItem[]
  /** Whether done and declined are listed too (?show=all). */
  includeClosed: boolean
}

// No tenant theme on the system surface (see the system sidebar), so every
// colour here is fixed: graphite for the active filter, status-* for state.
const FILTER_BASE = 'rounded-control px-3 py-1.5 text-sm transition-colors'
const FILTER_ACTIVE = 'bg-ink font-semibold text-white'
const FILTER_IDLE = 'text-ink-soft hover:bg-gray-100 hover:text-ink'

/**
 * N71: the three columns, one per feedback type. Each card carries its status
 * as a plain <select>: HeroUI's Select tints its rows with the tenant colour,
 * which this layout does not define.
 */
export function FeedbackBoard({ items, includeClosed }: Props) {
  const { t } = useTranslation('common')

  return (
    <>
      <div
        role="group"
        aria-label={t('feedback.triage.filterLabel')}
        className="mb-6 inline-flex gap-1 rounded-control border border-edge bg-white p-1"
      >
        <Link
          href="/admin/feedback"
          aria-current={!includeClosed ? 'page' : undefined}
          className={`${FILTER_BASE} ${!includeClosed ? FILTER_ACTIVE : FILTER_IDLE}`}
        >
          {t('feedback.triage.showOpen')}
        </Link>
        <Link
          href="/admin/feedback?show=all"
          aria-current={includeClosed ? 'page' : undefined}
          className={`${FILTER_BASE} ${includeClosed ? FILTER_ACTIVE : FILTER_IDLE}`}
        >
          {t('feedback.triage.showAll')}
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {FEEDBACK_TYPES.map((type) => {
          const column = items.filter((item) => item.type === type)
          const Icon = FEEDBACK_TYPE_ICON[type]
          const headingId = `feedback-column-${type}`
          return (
            <section key={type} aria-labelledby={headingId} className="min-w-0">
              <h2 id={headingId} className="mb-3 flex items-center gap-2">
                <Icon aria-hidden className="size-4 text-ink-label" strokeWidth={1.75} />
                <span className="section-label">{t(`feedback.triage.columns.${type}`)}</span>
                <span className="ml-auto rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-status-neutral-text">
                  {column.length}
                </span>
              </h2>
              {column.length === 0 ? (
                <p className="rounded-card-sm border border-dashed border-edge px-4 py-6 text-center text-sm text-ink-label">
                  {t('feedback.triage.empty')}
                </p>
              ) : (
                <ul className="space-y-3">
                  {column.map((item) => (
                    <li key={item.id}>
                      <FeedbackCard item={item} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}

function FeedbackCard({ item }: { item: TriageItem }) {
  const { t, i18n } = useTranslation('common')
  // Shown at once on change; put back if the save fails. The server page
  // re-renders afterwards (revalidatePath), which is what drops a card that
  // left the "Open" filter.
  const [status, setStatus] = useState<FeedbackStatus>(item.status)
  const [pending, startTransition] = useTransition()
  const [imageBroken, setImageBroken] = useState(false)

  // created_at is a real instant: the event time zone, not the browser's.
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: EVENT_TIME_ZONE,
  }).format(new Date(item.created_at))

  function onStatusChange(next: FeedbackStatus) {
    const previous = status
    setStatus(next)
    startTransition(async () => {
      const result = await updateFeedbackStatus(item.id, next)
      if (result.error) {
        setStatus(previous)
        toastError(result.error)
      }
    })
  }

  const sender = item.senderName ?? t('feedback.triage.unknownSender')
  // Some roster rows carry the number as the name (an admin added before the
  // name was asked for); showing it twice says nothing more.
  const digits = (s: string | null) => s?.replace(/\D/g, '') ?? ''
  const showPhone = !!item.senderPhone && digits(item.senderPhone) !== digits(item.senderName)
  const selectId = `feedback-status-${item.id}`

  return (
    <AppCard bodyClassName="p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
          {item.title}
        </h3>
        <FeedbackStatusChip status={status} />
      </div>

      <p className="mt-2 whitespace-pre-line text-sm text-ink-soft [overflow-wrap:anywhere]">
        {item.body}
      </p>

      {item.imageUrl && !imageBroken && (
        <a
          href={item.imageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 block w-fit"
          title={t('feedback.triage.openImage')}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from private storage; next/image would cache it past its expiry */}
          <img
            src={item.imageUrl}
            alt={t('feedback.triage.imageAlt')}
            onError={() => setImageBroken(true)}
            className="max-h-40 rounded-control border border-edge object-contain"
          />
        </a>
      )}
      {item.imageUrl && imageBroken && (
        <p className="mt-3 text-xs text-ink-label">{t('feedback.triage.imageUnavailable')}</p>
      )}

      <dl className="mt-3 space-y-1 border-t border-edge-soft pt-3 text-xs text-ink-label">
        <div className="flex gap-2">
          <dt className="sr-only">{t('feedback.triage.from')}</dt>
          <dd className="min-w-0">
            <span className="font-semibold text-ink-soft">{sender}</span>
            {showPhone && <span> · {item.senderPhone}</span>}
            <span> · {t(`feedback.triage.role.${item.user_role}`)}</span>
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">{t('feedback.triage.event')}</dt>
          <dd className="min-w-0">
            {item.tenantName ?? t('feedback.triage.noTenant')}
            {item.eventName && <span> · {item.eventName}</span>}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="sr-only">{t('feedback.triage.page')}</dt>
          <dd className="min-w-0 truncate font-mono" title={item.page_path}>
            {item.page_path}
          </dd>
        </div>
        <div>
          <dd>
            <time dateTime={item.created_at}>{date}</time>
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center gap-2">
        <label htmlFor={selectId} className="text-xs font-semibold text-ink-label">
          {t('feedback.triage.statusLabel')}
        </label>
        {/* The browser's own arrow sits flush against the right edge and
            cannot be padded, so it is hidden (appearance-none) and drawn
            here instead, with room on both sides. */}
        <div className="relative">
          <select
            id={selectId}
            value={status}
            disabled={pending}
            onChange={(e) => onStatusChange(e.target.value as FeedbackStatus)}
            className="appearance-none rounded-control border border-edge-field bg-white py-1.5 pl-3 pr-9 text-sm text-ink disabled:opacity-60"
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`feedback.status.${s}`)}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-label"
            strokeWidth={1.75}
          />
        </div>
      </div>
    </AppCard>
  )
}
