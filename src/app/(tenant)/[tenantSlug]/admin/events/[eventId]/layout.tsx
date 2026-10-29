import { notFound } from 'next/navigation'
import { getAdminEvent } from '@/lib/events/admin-event'
import { ArchivedEventBanner } from './_components/archived-event-banner'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// N23: every screen beneath this segment edits one event, named in the URL.
// This is where an event id from another tenant, a malformed id, or an id the
// caller cannot see becomes a 404, so the pages below can take eventId as
// belonging to the tenant. The admin check itself is the parent layout's.
//
// In the layout body, not behind Suspense, for the reason the parent layout
// gives: notFound() after streaming has started would answer 200.
export default async function AdminEventLayout({ children, params }: Props) {
  const { tenantSlug, eventId } = await params
  const event = await getAdminEvent(tenantSlug, eventId)

  if (!event) notFound()

  // An archived event is read-only in the database (the archive lock); the
  // banner says so on every screen of it.
  if (event.status !== 'archived') return children

  return (
    <>
      <ArchivedEventBanner tenantSlug={tenantSlug} eventId={eventId} />
      {children}
    </>
  )
}
