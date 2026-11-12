import { OfficialPageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while an official event screen renders on the server — on a
// phone on event day, a tap that leaves the screen untouched reads as "nothing
// happened" and gets tapped again.
//
// Placed here, beneath [eventId]/layout.tsx, on purpose: loading.tsx does not
// wrap the layout in its own segment, so the tenant and event-membership
// checks still finish before anything streams and still answer a real 404.
// ACCT-01 (/[tenantSlug]/account) sits outside this segment, which matters:
// its notFound() for a caller without an officials row is asserted as a 404
// in tests/e2e/access-control.spec.ts.
export default function Loading() {
  return <OfficialPageSkeleton />
}
