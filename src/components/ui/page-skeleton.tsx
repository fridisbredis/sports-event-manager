'use client'

import { Skeleton } from '@heroui/react'
import { useTranslation } from '@/lib/i18n/client'
import { CARD_SURFACE } from './card-styles'

// Route-level loading states, rendered by the loading.tsx files across the
// admin, official, participant and system surfaces. Without them a tap on a
// nav link left the previous screen standing, untouched, until the next one
// had rendered on the server — the app read as frozen rather than busy.
//
// Deliberately generic: one shape per surface, standing in for "a page is
// coming", not a pixel copy of each screen. They mirror the page padding and
// the card surface so the swap to real content does not jump.
//
// A client component so the screen-reader label can come from the client i18n
// instance already on the page. A server component would have to await the
// user's language first, and a fallback that waits on the database is not
// instant anymore.
//
// The bones are aria-hidden; the region announces itself once as busy.

function LoadingRegion({ className, children }: { className: string; children: React.ReactNode }) {
  const { t } = useTranslation('common')
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{t('common.loading')}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

function Bone({ className }: { className: string }) {
  return <Skeleton className={`rounded-md ${className}`} />
}

// Admin padding, which every tenant admin screen uses.
const ADMIN_PAGE_PADDING = 'px-4 py-6 md:px-8 md:py-8'

// Web-first admin screens (tenant and system admin): page header, a row of
// summary cards, then a list card — the shape of the dashboard and of every
// list screen. `className` carries the page's own padding/width where it
// differs from the tenant admin default (system admin centres at 1240px).
export function AdminPageSkeleton({ className = ADMIN_PAGE_PADDING }: { className?: string }) {
  return (
    <LoadingRegion className={className}>
      <div className="mb-8 flex flex-col gap-3">
        <Bone className="h-8 w-64 max-w-full" />
        <Bone className="h-4 w-40" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`${CARD_SURFACE} flex flex-col gap-4 p-6`}>
            <Bone className="h-4 w-28" />
            <Bone className="h-8 w-20" />
            <Bone className="h-3 w-full" />
          </div>
        ))}
      </div>

      <div className={`${CARD_SURFACE} flex flex-col gap-5 p-6`}>
        <Bone className="h-5 w-48" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Bone className="h-4 w-1/3" />
              <Bone className="h-3 w-1/5" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

// Mobile-first screens (official and participant): page title, then a stack
// of cards — the shape of home, event info, announcements and the schedule
// list.
export function MobilePageSkeleton() {
  return (
    <LoadingRegion className="px-5 pt-10 pb-6">
      <Bone className="mb-6 h-8 w-48" />

      <div className="flex flex-col gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`${CARD_SURFACE} flex items-center gap-4 px-4 py-4`}>
            <Skeleton className="size-12 shrink-0 rounded-large" />
            <div className="flex flex-1 flex-col gap-2">
              <Bone className="h-4 w-2/3" />
              <Bone className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}
