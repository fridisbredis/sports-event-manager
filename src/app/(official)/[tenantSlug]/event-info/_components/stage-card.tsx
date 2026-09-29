'use client'

import { AppCard } from '@/components/ui/app-card'

interface Props {
  stageNumber: number
  name: string
  date: string
  timeRange: string
  venue: string | null
}

export function StageCard({ stageNumber, name, date, timeRange, venue }: Props) {
  // Date, time and venue are one block of facts about the stage, not three
  // labelled fields — the reference drops the per-row icons and lets them
  // stack as plain lines, which reads faster and stops three grey glyphs from
  // competing with the numbered badge for attention.
  const details = [date, timeRange, venue].filter(Boolean)

  return (
    <AppCard bodyClassName="flex-row gap-3.5 p-4">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tenant-primary text-sm font-bold text-white">
        {stageNumber}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold leading-snug text-ink">{name}</p>
        {details.length > 0 ? (
          <div className="mt-1 flex flex-col gap-0.5">
            {details.map((line) => (
              <p key={line} className="text-[15px] leading-relaxed text-ink-muted">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </AppCard>
  )
}
