import { notFound, redirect } from 'next/navigation'

import { getAdminTenant, getCurrentUser } from '@/lib/auth/tenant'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { parseFeedbackOrigin } from '@/lib/feedback/origin'
import { FeedbackPageContent } from '@/components/feedback/feedback-page-content'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// N71: Feedback, next to Help and guide in the sidebar's support group.
// Tenant-level like Account rather than per event, so an admin with no event
// yet can still ask something; the sidebar passes the event and the page they
// came from as ?event=&from=.
export default async function AdminFeedbackPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout already authorized this
  // tenant; the check still runs for this page.
  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  const { fromPath, eventId } = parseFeedbackOrigin(await searchParams)

  return (
    <FeedbackPageContent
      tenantId={tenant.id}
      userId={user.id}
      language={await getUserLanguage()}
      surface="admin"
      eventId={eventId}
      fromPath={fromPath}
      layout="desktop"
    />
  )
}
