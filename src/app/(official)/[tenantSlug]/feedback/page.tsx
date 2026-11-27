import { notFound, redirect } from 'next/navigation'

import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { parseFeedbackOrigin } from '@/lib/feedback/origin'
import { FeedbackPageContent } from '@/components/feedback/feedback-page-content'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

// N71: Feedback for officials, reached from a card on the account page — the
// tab bar is full (five tabs), so it gets no tab of its own.
export default async function OfficialFeedbackPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares the layout's access check.
  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant) notFound()

  const { fromPath, eventId } = parseFeedbackOrigin(await searchParams)

  return (
    <FeedbackPageContent
      tenantId={tenant.id}
      userId={user.id}
      language={await getUserLanguage()}
      surface="official"
      eventId={eventId}
      fromPath={fromPath}
      layout="mobile"
    />
  )
}
