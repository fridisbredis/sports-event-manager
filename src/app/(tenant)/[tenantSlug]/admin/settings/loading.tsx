import { AdminPageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while settings render. The admin gate is the parent layout's,
// which this boundary does not wrap.
export default function Loading() {
  return <AdminPageSkeleton />
}
