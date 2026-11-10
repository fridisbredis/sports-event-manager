'use client'

import Image from 'next/image'
import { AppCard } from '@/components/ui/app-card'
import { LogoPlaceholder } from './icons'

interface Props {
  name: string
  eventType: string
  logoUrl: string | null
  description: string | null
}

export function EventHeaderCard({ name, eventType, logoUrl, description }: Props) {
  return (
    <AppCard className="mb-6" bodyClassName="gap-4 p-5">
      <div className="flex items-start gap-4">
        {logoUrl ? (
          <Image
            src={logoUrl}
            alt={name}
            width={64}
            height={64}
            // Tenant logos are uploaded at whatever aspect ratio the organizer
            // has; without a fixed box plus object-cover a wide logo renders
            // stretched. size-16 pins the box to the same 64px the
            // placeholder uses, so a tenant with and without a logo get an
            // identically sized plate.
            className="size-16 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <LogoPlaceholder size={64} />
        )}
        <div className="min-w-0 pt-0.5">
          <p className="text-[19px] font-bold leading-snug text-ink">{name}</p>
          {/* The event type is a subtitle, not a chip. It is a fixed fact
              about the event, never a filter or a status that changes — and
              as a tinted pill it read as interactive and pulled more weight
              than the event's own name beside it. */}
          {eventType ? (
            <p className="mt-0.5 text-[15px] capitalize leading-relaxed text-ink-muted">
              {eventType}
            </p>
          ) : null}
        </div>
      </div>
      {/* No divider above the description. Name, type and description are one
          continuous introduction to the event, and a rule across the card cut
          it into two unrelated halves; the gap between them already separates
          them enough. */}
      {description ? (
        <p className="text-[15px] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
    </AppCard>
  )
}
