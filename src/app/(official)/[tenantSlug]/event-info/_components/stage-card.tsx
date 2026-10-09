'use client'

import { MapPin } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'

interface Props {
  stageNumber: number
  name: string
  details: string[]
  venue: string | null
}

export function StageCard({ stageNumber, name, details, venue }: Props) {
  // The schedule facts run as one dot-separated line that wraps, rather than
  // one line per fact. They are read as a sequence ("briefing, then start,
  // then podium"), and stacking them made a three-fact stage card twice as
  // tall as a one-fact one, so a list of stages lost its rhythm.
  //
  // The venue is back on this card, on its own line below that sequence. It
  // used to be inline here, then moved to a section of its own — but that
  // section listed the same stages a third time down the screen to carry one
  // short string each. A stage's day, hours and place are one answer to one
  // question ("where do I need to be, and when"), so they belong on one card.
  // It stays out of the dot-separated line because that line is about time;
  // a separate line with a pin reads as the place without lengthening it.
  return (
    <AppCard className="card-accent-left" bodyClassName="flex-row gap-3.5 p-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tenant-primary text-sm font-bold text-white">
        {stageNumber}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold leading-snug text-ink">{name}</p>
        {details.length > 0 ? (
          <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">
            {details.map((line, i) => (
              <span key={line}>
                {i > 0 ? <span className="text-ink-faint"> · </span> : null}
                {line}
              </span>
            ))}
          </p>
        ) : null}
        {/* No map link behind the pin, so it is marked decorative and the
            venue reads as plain text — an icon that looks tappable but does
            nothing is worse than no icon. It can become a link with the map. */}
        {venue ? (
          <p className="mt-1 flex items-center gap-1.5 text-[15px] leading-relaxed text-ink-muted">
            <MapPin
              className="size-4 shrink-0 text-ink-faint"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <span className="min-w-0">{venue}</span>
          </p>
        ) : null}
      </div>
    </AppCard>
  )
}
