'use client'

import { Skeleton } from '@heroui/react'

// The placeholder body shared by the official tabs' loading.tsx files.
//
// 'use client' is required, and is the whole reason this is a separate file
// from the loading.tsx files that render it. Importing from the
// '@heroui/react' barrel pulls in a provider chain that calls createContext,
// which throws at request time inside a server component — and neither tsc
// nor next build catches it, because the file compiles fine and fails only
// when the route is actually rendered. The directive makes this the client
// boundary, so a server component may render it. Cheap to mark: the subtree
// is a handful of empty boxes.
//
// aria-hidden with a polite status line beside it: a screen reader should
// hear "loading" once, not count empty boxes. Each loading.tsx passes the
// label already translated, since it has the `t` this has no access to.
export function SkeletonRows({
  label,
  rows = 3,
  height = 'h-[4.5rem]',
  gutter = false,
}: {
  label: string
  rows?: number
  // Rows are sized per tab rather than fixed, so each placeholder matches the
  // card it stands in for and the real content lands without the page moving.
  height?: string
  // The schedule's time column. Off everywhere else, where cards run the full
  // width.
  gutter?: boolean
}) {
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">
        {label}
      </p>
      <div aria-hidden="true" className="space-y-3">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex items-start gap-3">
            {gutter ? <Skeleton className="mt-3 h-4 w-14 shrink-0 rounded-md" /> : null}
            <Skeleton className={`${height} w-full rounded-xl`} />
          </div>
        ))}
      </div>
    </>
  )
}
