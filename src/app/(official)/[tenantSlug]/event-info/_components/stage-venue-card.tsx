'use client'

import { AppCard } from '@/components/ui/app-card'

// Location & venue per stage. One card holding every stage's venue rather
// than a card each: the venues are read together ("where am I on Saturday?"),
// and one card per one-line venue would stack three near-empty panels.
//
// No map-pin plate. The reference design shows one, but there is no map or
// coordinate behind it to open, and an icon that looks tappable but does
// nothing is worse than no icon. It can come back with the map link.
//
// Stages without a venue are filtered out upstream, so every row here has
// one — a row reading "Stage 2 · —" tells an official nothing they could act
// on and makes the list harder to scan for the venues that do exist.
interface StageVenue {
  id: string
  name: string
  venue: string
}

export function StageVenueCard({ stages }: { stages: StageVenue[] }) {
  return (
    <AppCard bodyClassName="gap-1.5 p-4">
      {stages.map((stage) => (
        <p key={stage.id} className="text-[15px] leading-relaxed text-ink">
          <span className="font-bold">{stage.name}</span>
          <span className="text-ink-faint"> · </span>
          <span className="text-ink-muted">{stage.venue}</span>
        </p>
      ))}
    </AppCard>
  )
}
