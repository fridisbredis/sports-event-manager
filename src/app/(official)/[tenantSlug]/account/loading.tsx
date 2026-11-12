import { MobilePageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while ACCT-01 renders. The roster-row gate sits in this
// segment's layout.tsx, outside the boundary, so a caller without an officials
// row still gets a real 404 (asserted in tests/e2e/access-control.spec.ts).
export default function Loading() {
  return <MobilePageSkeleton />
}
