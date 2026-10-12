'use client'

import { Skeleton } from '@heroui/react'

// The placeholder bodies shared by the admin routes' loading.tsx files.
//
// 'use client' is required, and is why this is a separate file from the
// loading.tsx files that render it. Importing from the '@heroui/react' barrel
// pulls in a provider chain that calls createContext, which throws at request
// time inside a server component — and neither tsc nor next build catches it,
// because the file compiles fine and fails only when the route is rendered.
// The directive makes this the client boundary, so a server component may
// render it.
//
// aria-hidden with a polite status line beside it: a screen reader should
// hear "loading" once, not count empty boxes. Each loading.tsx passes the
// label already translated, since it has the `t` this has no access to.

export function AdminLoadingStatus({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {label}
    </p>
  )
}

// A stack of full-width cards — the shape of the list screens (officials,
// workstations, communication).
export function SkeletonList({ rows = 5, height = 'h-16' }: { rows?: number; height?: string }) {
  return (
    <div aria-hidden="true" className="space-y-3">
      {Array.from({ length: rows }, (_, row) => (
        <Skeleton key={row} className={`${height} w-full rounded-xl`} />
      ))}
    </div>
  )
}

// A header band: a title bar with a shorter subtitle under it, and optionally
// an action button to its right. Mirrors the admin pages' heading block
// rather than the app-wide .page-title, which these screens do not use.
export function SkeletonHeader({ action = false }: { action?: boolean }) {
  return (
    <div aria-hidden="true" className="mb-8 flex items-start justify-between gap-4">
      <div className="min-w-0 flex-1">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full rounded-md" />
      </div>
      {action ? <Skeleton className="h-10 w-32 shrink-0 rounded-large" /> : null}
    </div>
  )
}

// A form: label-and-field pairs in a card, for the event config and account
// screens.
export function SkeletonForm({ fields = 5 }: { fields?: number }) {
  return (
    <div aria-hidden="true" className="space-y-6 rounded-xl bg-white p-6">
      {Array.from({ length: fields }, (_, field) => (
        <div key={field}>
          <Skeleton className="h-4 w-28 rounded-md" />
          <Skeleton className="mt-2 h-11 w-full rounded-large" />
        </div>
      ))}
    </div>
  )
}

// The scheduling grid: a header row of time slots over a body of rows. Wider
// and denser than the list screens, and the one admin screen whose placeholder
// has to say "grid" rather than "list".
export function SkeletonGrid({ rows = 6, columns = 8 }: { rows?: number; columns?: number }) {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl bg-white p-4">
      <div className="mb-3 flex gap-2">
        <Skeleton className="h-8 w-40 shrink-0 rounded-md" />
        {Array.from({ length: columns }, (_, col) => (
          <Skeleton key={col} className="h-8 flex-1 rounded-md" />
        ))}
      </div>
      <div className="space-y-2">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex gap-2">
            <Skeleton className="h-10 w-40 shrink-0 rounded-md" />
            {Array.from({ length: columns }, (_, col) => (
              <Skeleton key={col} className="h-10 flex-1 rounded-md" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// A row of stat tiles, as the dashboard leads with.
export function SkeletonTiles({ tiles = 4 }: { tiles?: number }) {
  return (
    <div aria-hidden="true" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: tiles }, (_, tile) => (
        <Skeleton key={tile} className="h-28 w-full rounded-xl" />
      ))}
    </div>
  )
}
