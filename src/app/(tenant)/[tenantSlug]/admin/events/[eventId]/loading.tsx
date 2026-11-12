import { AdminPageSkeleton } from '@/components/ui/page-skeleton'

// Instant feedback while an admin event screen renders on the server.
//
// Placed here, beneath [eventId]/layout.tsx, on purpose: loading.tsx does not
// wrap the layout in its own segment, so the tenant and event checks above
// still finish before anything streams and still answer a real 404
// (tests/e2e/access-control.spec.ts asserts the status). Moving this up to
// admin/ or [tenantSlug]/ would put admin/account and the legacy redirects
// behind the boundary and turn their notFound() into a 200.
//
// A page's own notFound() below this point (an unknown workstation id, say)
// does answer 200 with a noindex body; those are admin-only detail lookups,
// not the access gates, which all live in the layouts.
export default function Loading() {
  return <AdminPageSkeleton />
}
