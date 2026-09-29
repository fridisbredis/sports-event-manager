'use client'

import { AppCard } from '@/components/ui/app-card'

interface Props {
  stageNumber: number
  name: string
  details: string[]
}

export function StageCard({ stageNumber, name, details }: Props) {
  // The schedule facts run as one dot-separated line that wraps, rather than
  // one line per fact. They are read as a sequence ("briefing, then start,
  // then podium"), and stacking them made a three-fact stage card twice as
  // tall as a one-fact one, so a list of stages lost its rhythm.
  //
  // The venue used to sit in this line too. It now has its own section above,
  // and repeating it here made the card's most-scanned line longer without
  // adding anything.
  return (
    <AppCard bodyClassName="flex-row gap-3.5 p-4">
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
      </div>
    </AppCard>
  )
}
