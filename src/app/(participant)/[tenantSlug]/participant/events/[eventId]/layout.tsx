import { notFound } from 'next/navigation'
import { getParticipantTenant } from '@/lib/auth/tenant'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// The participant's entry check for one event, lifted out of info/page.tsx so
// it runs before [eventId]/loading.tsx starts streaming — a notFound() behind
// that boundary would answer 200. Mirrors the admin and official [eventId]
// layouts (N23). get_event_info_cached answers for any event in the tenant, so
// without this a participant could read a sibling event by editing the URL.
// getParticipantTenant is memoised and the parent layout has already resolved
// it, so this adds no query. The page keeps its own check as well.
export default async function ParticipantEventLayout({ children, params }: Props) {
  const { tenantSlug, eventId } = await params
  const tenant = await getParticipantTenant(tenantSlug)
  if (!tenant || !tenant.entries.some((e) => e.eventId === eventId)) notFound()
  return children
}
