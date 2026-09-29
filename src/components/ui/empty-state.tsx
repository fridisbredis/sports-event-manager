import type { LucideIcon } from 'lucide-react'
import { CARD_SURFACE } from './card-styles'

// The one empty state for the official surfaces. Before this existed, the
// schedule and announcements screens each carried their own near-identical
// copy, both marked with a grey "missing image" cross — a broken-image glyph
// on a screen whose content simply hasn't been created yet reads as a fault
// rather than as "nothing here so far".
//
// The icon is passed in so each tab is marked by its own subject (calendar,
// bell, info, pin) instead of four screens sharing one anonymous placeholder.
// The plate uses the tenant tint, the same bubble treatment as the home
// screen's nav cards, so an empty tab still sits inside the tenant's palette.
export function EmptyState({
  Icon,
  title,
  description,
  children,
  className,
}: {
  Icon: LucideIcon
  title: string
  description?: string
  /** Optional action below the copy — e.g. a link back to the newest page. */
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-8 py-16 text-center ${className ?? ''}`}
    >
      <div className="mb-4 flex size-16 items-center justify-center rounded-large bg-tenant-primary-tint text-tenant-primary-tint-text">
        <Icon className="size-8" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-[34ch] text-sm leading-relaxed text-ink-label">{description}</p>
      ) : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  )
}

// Same empty state, but boxed on a card surface. Used where the empty tab sits
// among other cards on a scrolling page (event info) rather than alone in an
// otherwise blank tab.
export function EmptyStateCard(props: React.ComponentProps<typeof EmptyState>) {
  return <EmptyState {...props} className={`${CARD_SURFACE} py-12 ${props.className ?? ''}`} />
}
