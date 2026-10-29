'use client'

import { Chip } from '@/components/ui/chip'
import { SectionCard } from './section-card'

/**
 * This month's SMS spend against the tenant's cap (N24).
 *
 * Deliberately the quietest card on the dashboard while there is nothing to
 * act on. A normal event spends around a sixth of its allowance, so for most
 * of the year this is a single line of reassurance — it earns its place by
 * being checkable, not by being prominent.
 *
 * It grows teeth in two steps:
 *   - approaching: an amber chip and the bar, while there is still time to
 *     change what you send
 *   - reached: a danger chip and a sentence saying plainly that sending has
 *     stopped and when it resumes, because the alternative is an admin
 *     wondering why their invites vanished
 *
 * That last state is the reason the card exists at all. Without it a capped
 * tenant sees invites silently fail and phones Peter.
 */

interface SmsUsageCardProps {
  title: string
  /** SEK spent this calendar month. */
  spentAmount: number
  /** The tier's monthly allowance in SEK. */
  capAmount: number
  /** spentAmount / capAmount, already clamped to 1 by the cap reader. */
  fraction: number
  /** True once sending is actually blocked. */
  exceeded: boolean
  /** Formatted "56 kr of 300 kr" — built server-side so currency and number
   *  formatting follow the viewer's locale rather than being assembled here. */
  amountLabel: string
  okLabel: string
  approachingLabel: string
  reachedLabel: string
  /** Shown only when sending has stopped. Explains the consequence. */
  blockedExplanation: string
  /** Shown when the figures rest on the built-in rate rather than a
   *  configured one. Omitted entirely otherwise — see cost.ts. */
  estimateNote?: string
}

/** The point at which the bar and an amber chip appear. */
const APPROACHING = 0.8

export function SmsUsageCard({
  title,
  spentAmount: _spentAmount,
  capAmount: _capAmount,
  fraction,
  exceeded,
  amountLabel,
  okLabel,
  approachingLabel,
  reachedLabel,
  blockedExplanation,
  estimateNote,
}: SmsUsageCardProps) {
  const approaching = !exceeded && fraction >= APPROACHING
  const showBar = approaching || exceeded

  const status = exceeded ? reachedLabel : approaching ? approachingLabel : okLabel

  return (
    <SectionCard>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="section-label">{title}</h2>
          <span className="text-[13px] tabular-nums text-ink-muted">{amountLabel}</span>
        </div>
        <Chip
          size="sm"
          variant={exceeded ? 'flat' : approaching ? 'flat' : 'bordered'}
          color={exceeded ? 'danger' : approaching ? 'warning' : 'default'}
        >
          {status}
        </Chip>
      </div>

      {/* The bar is withheld below the threshold on purpose. A permanently
          near-empty meter trains the eye to ignore it, which is the opposite
          of what it is for. */}
      {showBar && (
        <div
          className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-edge-soft"
          role="progressbar"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={title}
        >
          <div
            className={`h-full rounded-full ${exceeded ? 'bg-destructive' : 'bg-status-pending-text'}`}
            style={{ width: `${Math.max(fraction * 100, 2)}%` }}
          />
        </div>
      )}

      {exceeded && <p className="mt-3 text-[13px] text-ink">{blockedExplanation}</p>}

      {estimateNote && <p className="mt-2 text-[12px] text-ink-muted">{estimateNote}</p>}
    </SectionCard>
  )
}
