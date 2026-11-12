import { notFound } from 'next/navigation'
import { hasAccountScreen } from '@/lib/auth/tenant'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

// ACCT-01's gate, lifted out of the page so it runs before account/loading.tsx
// starts streaming: a notFound() behind that boundary would answer 200. A
// role-only admin has no `officials` row and so no account to edit here — the
// same answer the nav uses to hide the link. Memoised, and the admin layout
// above has already resolved it, so this adds no query. The page keeps its own
// row lookup and notFound() as well.
export default async function AdminAccountLayout({ children, params }: Props) {
  const { tenantSlug } = await params
  if (!(await hasAccountScreen(tenantSlug))) notFound()
  return children
}
