import { AdminPageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while a system admin screen renders. The system admin gate
// is (system)/layout.tsx, two segments up and outside this boundary, so a
// non-system-admin still gets a real 404. An unknown tenant id on [tenantId]
// answers its notFound() under a 200 — reachable only by a system admin.
export default function Loading() {
  return <AdminPageSkeleton className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10" />
}
