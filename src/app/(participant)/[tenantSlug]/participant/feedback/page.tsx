import { notFound, redirect } from 'next/navigation'

import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { parseFeedbackOrigin } from '@/lib/feedback/origin'
import { FeedbackPageContent } from '@/components/feedback/feedback-page-content'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// N71: Feedback for participants, reached from a card on the account page.
// Like the account page, reachable whatever the state of the caller's events,
// so it does not ask isParticipantSideOpen.
export default async function ParticipantFeedbackPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const tenant = await getParticipantTenant(tenantSlug)
  if (!tenant) notFound()

  const { fromPath, eventId } = parseFeedbackOrigin(await searchParams)

  return (
    <FeedbackPageContent
      tenantId={tenant.id}
      userId={user.id}
      language={await getUserLanguage()}
      surface="participant"
      eventId={eventId}
      fromPath={fromPath}
      layout="mobile"
    />
  )
}
