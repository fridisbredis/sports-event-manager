import { MobilePageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback for the event picker. In a route group so the boundary wraps
// this page alone and not events/[eventId]/layout.tsx, whose membership 404
// must not start streaming first. With a single event the page redirects;
// behind the boundary that redirect is applied client-side, which lands on
// the same URL.
export default function Loading() {
  return <MobilePageSkeleton />
}
