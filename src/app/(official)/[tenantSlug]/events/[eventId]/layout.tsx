import { after } from 'next/server'
import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getOfficialEvent } from '@/lib/events/official-event'
import { logger } from '@/lib/logger'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// N23: every official screen beneath this segment shows one event, named in
// the URL. An official who is not a member of it gets a 404 — they must not
// learn of events in the tenant they were not invited to — and so does an id
// from another tenant or a malformed one. Admins reach every event, as in
// admin. The parent layout has already checked access to the tenant.
//
// In the layout body, not behind Suspense: notFound() after streaming has
// started would answer 200 (see the admin layout).
export default async function OfficialEventLayout({ children, params }: Props) {
  const { tenantSlug, eventId } = await params
  const event = await getOfficialEvent(tenantSlug, eventId)

  if (!event) notFound()

  // Opening the event clears its "new" notice in the picker. After the
  // response, so a slow or failed write never holds up the page; the client
  // is created here because request APIs are not available inside after().
  const supabase = await createSupabaseServerClient()
  after(async () => {
    const { error } = await supabase.rpc('mark_official_event_seen', { p_event_id: eventId })
    if (error) logger.warn('N23: could not mark event seen', { eventId, code: error.code })
  })

  return children
}
