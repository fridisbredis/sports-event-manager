import { AdminPageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback for the events list. In a route group so the boundary wraps
// this page alone: one at admin/ would also wrap events/[eventId]/layout.tsx,
// whose notFound() for a foreign event must stay a real 404 (see
// events/[eventId]/loading.tsx).
export default function Loading() {
  return <AdminPageSkeleton />
}
