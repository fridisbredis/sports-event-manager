'use client'

import Link from 'next/link'

import { AppCard } from '@/components/ui/app-card'

interface ParticipantsCardProps {
  title: string
  claimed: number
  total: number
  /** "28 of 42 claimed" — already translated. */
  claimedLabel: string
  href: string
}

/**
 * N41 (L21): how many participants have claimed their record, beside the
 * officials counts. The figure comes from fetchClaimCounts, the same
 * function PART-01's header uses, so the two screens cannot disagree.
 *
 * The whole card links to PART-01: the next thing an admin does with this
 * number is look at who is missing.
 */
export function ParticipantsCard({
  title,
  claimed,
  total,
  claimedLabel,
  href,
}: ParticipantsCardProps) {
  return (
    <Link
      href={href}
      className="block rounded-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tenant-primary"
    >
      <AppCard className="card-accent-primary h-full transition-shadow hover:shadow-modal">
        <h2 className="section-label mb-4">{title}</h2>
        <div
          className="font-display text-[32px] font-bold leading-none tracking-tight tabular-nums text-ink"
          aria-hidden="true"
        >
          <span className="text-tenant-primary">{claimed}</span>
          <span className="text-ink-faint"> / {total}</span>
        </div>
        <div className="mt-1.5 text-[13px] text-ink-muted">{claimedLabel}</div>
      </AppCard>
    </Link>
  )
}
