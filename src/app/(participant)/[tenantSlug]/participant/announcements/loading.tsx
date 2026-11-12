import { MobilePageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while announcements render. The participant gate is the
// parent layout's, which this boundary does not wrap.
export default function Loading() {
  return <MobilePageSkeleton />
}
