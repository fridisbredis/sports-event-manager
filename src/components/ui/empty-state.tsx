import type { LucideIcon } from 'lucide-react'
import { CARD_SURFACE } from './card-styles'

// The one empty state for the whole app — official tabs and admin screens
// alike. Before this existed, every screen hand-rolled its own, and most were
// marked with a grey cross: either a "missing image" glyph or a crossed-out
// box. A broken-image mark on a screen whose content simply hasn't been
// created yet reads as a fault rather than as "nothing here so far".
//
// The icon is passed in so each surface is marked by its own subject
// (calendar, bell, users, work-area pin) instead of every screen sharing one
// anonymous placeholder. The plate uses the tenant tint — the same bubble
// treatment as the official home screen's nav cards — so an empty screen
// still sits inside the tenant's palette on both sides of the app.
//
// `children` is the slot for whatever gets the user out of the empty state:
// a link back to the newest page, or the primary action that creates the
// first row ("Add official", "Create tenant").
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

// Same empty state, but boxed on a card surface. Used where it sits among
// other cards on a scrolling page (event info), or stands in for a panel the
// screen would otherwise draw as a card — a table, or the scheduling grid.
export function EmptyStateCard(props: React.ComponentProps<typeof EmptyState>) {
  return <EmptyState {...props} className={`${CARD_SURFACE} py-12 ${props.className ?? ''}`} />
}
