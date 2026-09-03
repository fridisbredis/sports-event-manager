import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { parsePageParam, pageRange, splitPage } from '@/lib/pagination'
import { CommunicationPanel } from './_components/communication-panel'

interface Props {
  params: Promise<{ tenantSlug: string }>
  searchParams: Promise<{ page?: string }>
}

const ANNOUNCEMENT_FIELDS = 'id, tenant_id, channel, body, sms_sent, published_at, created_at'

export default async function CommunicationPage({ params, searchParams }: Props) {
  const { tenantSlug } = await params
  const { page: pageParam } = await searchParams
  const page = parsePageParam(pageParam)

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  // Paged rather than capped (PERF-06): announcements only accumulate, and a
  // bare row ceiling would silently hide the oldest ones. Each range asks for
  // one row past the page so `hasMore` needs no second count query.
  //
  // One query per channel, not one for both: the panel's channel toggle is
  // local state, so a single paged query over the mixed list could return a
  // page of nothing but participants announcements and leave the officials
  // timeline looking empty while older ones exist. Two bounded reads keep the
  // toggle instant — no navigation, no SSR render per click, which matters
  // because PERF-01 found SSR CPU to be the binding constraint.
  const { from, to } = pageRange(page)

  const channelQuery = (channel: 'participants' | 'officials') =>
    supabase
      .from('announcements')
      .select(ANNOUNCEMENT_FIELDS)
      .eq('tenant_id', tenant.id)
      .eq('channel', channel)
      .order('published_at', { ascending: false })
      .range(from, to)

  const [participantsResult, officialsResult] = await Promise.all([
    channelQuery('participants'),
    channelQuery('officials'),
  ])

  const queryError = participantsResult.error ?? officialsResult.error
  if (queryError) throw queryError

  const participants = splitPage(participantsResult.data ?? [])
  const officials = splitPage(officialsResult.data ?? [])

  return (
    <div className="px-8 py-8">
      <CommunicationPanel
        tenantId={tenant.id}
        page={page}
        announcements={{ participants: participants.items, officials: officials.items }}
        hasMore={{ participants: participants.hasMore, officials: officials.hasMore }}
      />
    </div>
  )
}
