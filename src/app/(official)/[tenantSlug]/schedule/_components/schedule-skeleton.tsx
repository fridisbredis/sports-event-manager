'use client'

import { Skeleton } from '@heroui/react'

// Stands in for the day's shifts while a day is fetched.
//
// Shaped like the thing it replaces rather than a generic spinner: a time
// gutter and a row of cards, at the same widths and heights as the real rows
// in schedule-view, so the content lands in place instead of pushing the
// screen around as it arrives. Three rows is a typical day on this screen —
// enough to read as "shifts are coming", not so many that a one-shift day
// visibly collapses.
//
// aria-hidden with a live region alongside it: a screen reader should hear
// "loading", not six empty boxes. The placeholder rows are inert to the
// accessibility tree and the status line carries the meaning.
//
// Its own file because two callers need it: the route's loading.tsx and
// schedule-view's pending branch.
//
// 'use client' is required even though nothing here holds state. Importing
// from the '@heroui/react' barrel pulls in its provider chain, which calls
// createContext — and loading.tsx is a server component, so without this
// directive that call happens on the server and throws. The directive makes
// this file the client boundary, which is what lets a server component render
// it. Marking it is cheap: the subtree is six empty boxes.
export function ScheduleSkeleton({ label }: { label: string }) {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {label}
      </p>
      <div aria-hidden="true" className="space-y-3">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex items-start gap-3">
            <Skeleton className="mt-3 h-4 w-14 shrink-0 rounded-md" />
            <Skeleton className="h-[4.5rem] w-full rounded-xl" />
          </div>
        ))}
      </div>
    </>
  )
}
