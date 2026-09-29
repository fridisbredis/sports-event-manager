'use client'

import { Bell } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'

interface Props {
  time: string
  body: string
}

export function AnnouncementCard({ time, body }: Props) {
  return (
    // card-accent-left is the shared leading-edge accent from globals.css —
    // the same one the admin side puts on its announcement rows in COMM-01,
    // so the two views of one announcement are marked identically. It is an
    // inset shadow rather than a border, which keeps the rail inside
    // AppCard's radius and off the box model.
    <AppCard className="card-accent-left" bodyClassName="flex-row gap-3 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tenant-primary-tint text-tenant-primary-tint-text">
        <Bell className="size-5" strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-label">{time}</p>
        {/* The body is the reason the card exists, so it carries the weight
            the old text-sm gave away to the timestamp above it. */}
        <p className="mt-1 text-[17px] leading-relaxed text-ink">{body}</p>
      </div>
    </AppCard>
  )
}
