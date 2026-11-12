import { notFound } from 'next/navigation'
import { hasAccountScreen } from '@/lib/auth/tenant'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// ACCT-01's gate, lifted out of the page so it runs before account/loading.tsx
// starts streaming: a notFound() behind that boundary would answer 200, and
// tests/e2e/access-control.spec.ts asserts the 404 for a caller without an
// officials row (the seeded system admin). Memoised on the same
// getOfficialTenant resolution as the layout above, so this adds no query. The
// page keeps its own row lookup and notFound() as well.
export default async function OfficialAccountLayout({ children, params }: Props) {
  const { tenantSlug } = await params
  if (!(await hasAccountScreen(tenantSlug))) notFound()
  return children
}
