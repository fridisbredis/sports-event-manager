import { AdminPageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while ACCT-01 renders. The roster-row gate sits in this
// segment's layout.tsx, outside the boundary, so it still answers a real 404.
export default function Loading() {
  return <AdminPageSkeleton />
}
