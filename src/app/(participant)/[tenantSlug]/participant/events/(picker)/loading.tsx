import { MobilePageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback for the event info picker (B29). In a route group so the
// boundary wraps this page alone and not events/[eventId]/layout.tsx, whose
// entry check 404 must not start streaming first — same reason as the
// official picker.
export default function Loading() {
  return <MobilePageSkeleton />
}
