import { MobilePageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback for participant home. In a route group so the boundary wraps
// this page alone and not events/[eventId]/layout.tsx and its entry check.
export default function Loading() {
  return <MobilePageSkeleton />
}
