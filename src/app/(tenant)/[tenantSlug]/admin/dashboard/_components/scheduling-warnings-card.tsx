'use client'

import Link from 'next/link'
import { AppCard } from '@/components/ui/app-card'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { BigStat } from './big-stat'

interface SchedulingWarningsCardProps {
  title: string
  overCapacity: number
  overCapacityLabel: string
  doubleBooked: number
  doubleBookedLabel: string
  timeOffClash: number
  timeOffClashLabel: string
  allClearLabel: string
  issuesLabel: string
  reviewHref: string
  reviewLabel: string
}

export function SchedulingWarningsCard({
  title,
  overCapacity,
  overCapacityLabel,
  doubleBooked,
  doubleBookedLabel,
  timeOffClash,
  timeOffClashLabel,
  allClearLabel,
  issuesLabel,
  reviewHref,
  reviewLabel,
}: SchedulingWarningsCardProps) {
  const totalWarnings = overCapacity + doubleBooked + timeOffClash

  return (
    <AppCard className="card-accent-secondary">
      <div className="flex items-start justify-between mb-4">
        <h2 className="section-label">{title}</h2>
        {/* All-clear reads as a positive confirmation (green outline + check),
            not a neutral label — the handoff draws the eye to it. */}
        <Chip
          size="sm"
          variant={totalWarnings === 0 ? 'bordered' : 'flat'}
          color={totalWarnings === 0 ? 'default' : 'warning'}
          className={
            totalWarnings === 0
              ? 'border-status-ok-border bg-status-ok-soft font-semibold text-status-ok-text'
              : undefined
          }
          startContent={
            totalWarnings === 0 ? (
              <svg
                aria-hidden="true"
                className="ml-0.5 h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : undefined
          }
        >
          {totalWarnings === 0 ? allClearLabel : issuesLabel}
        </Chip>
      </div>
      {/* Wraps rather than squeezing: the labels name their unit now
          ("Officials double-booked", not "Double-booked"), which is long
          enough that three across does not fit a narrow card. */}
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <BigStat value={overCapacity} label={overCapacityLabel} />
        <BigStat value={doubleBooked} label={doubleBookedLabel} />
        <BigStat value={timeOffClash} label={timeOffClashLabel} />
      </div>
      {totalWarnings > 0 && (
        <div className="mt-5">
          {/* `sm`: a secondary jump out of a stats card, not the page's
              main action — at the default size it outweighed the figures
              it is meant to follow up on. */}
          <Button as={Link} href={reviewHref} variant="bordered" size="sm">
            {reviewLabel}
          </Button>
        </div>
      )}
    </AppCard>
  )
}
