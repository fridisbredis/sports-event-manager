import { MobilePageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while event info renders. Beneath [eventId]/layout.tsx, so
// the entry check there still answers a real 404 before anything streams.
export default function Loading() {
  return <MobilePageSkeleton />
}
