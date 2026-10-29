import { redirect, notFound } from 'next/navigation'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { logQueryError } from '@/lib/db/query-error'
import { hasFeature } from '@/lib/tiers/features'
import { parsePageParam, pageRange } from '@/lib/pagination'
import { parseRaceResultsEventId } from '@/lib/race-results/parse-url'

import ParticipantsList from './_components/participants-list'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
  searchParams: Promise<{ page?: string; stage?: string; withdrawn?: string }>
}

/**
 * PAGINATED, not merely capped — the one place this page deliberately
 * departs from the officials roster it otherwise mirrors.
 *
 * OFF-01 uses checkReadCeiling with a ceiling of 500 and justifies it by a
 * confirmed 10-15 officials per tenant. Participants are a different order
 * of magnitude (42 for Viadal today, with no ceiling in principle), and
 * checkReadCeiling's own docstring says it is not pagination. So the page
 * pages, and keeps the ceiling as a backstop above it.
 */
const PARTICIPANTS_PAGE_SIZE = 50
const PARTICIPANTS_CEILING = 2000

export default async function ParticipantsPage({ params, searchParams }: Props) {
  const { tenantSlug, eventId } = await params
  const { page: pageParam, stage: stageParam, withdrawn: withdrawnParam } = await searchParams

  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout already resolved and
  // authorised this tenant.
  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) notFound()

  // The tier gate. notFound() rather than a "please upgrade" page: on
  // Standard this screen does not exist, which is also what the sidebar
  // says by omitting the link. The server actions carry the same gate
  // independently — this one only hides the page.
  if (!hasFeature(tenant.tier, 'participants')) notFound()

  const supabase = await createSupabaseServerClient()

  const page = parsePageParam(pageParam)
  const { from, to } = pageRange(page, PARTICIPANTS_PAGE_SIZE)
  const showWithdrawn = withdrawnParam === '1'

  // Race stages, for the stage filter and for the import dialog. Which of
  // them actually has a Race Results link decides what can be imported, so
  // that is resolved here rather than in the client: the dialog can then
  // say "no link on this stage" instead of offering an import that cannot
  // run.
  const { data: stageRows, error: stagesError } = await supabase
    .from('event_stages')
    .select('id, name, stage_type, results_url, position')
    .eq('tenant_id', tenant.id)
    .eq('event_id', eventId)
    .eq('stage_type', 'race')
    .order('position', { ascending: true })

  if (stagesError) {
    logQueryError(stagesError, {
      op: 'admin/participants',
      table: 'event_stages',
      kind: 'select',
      tenantId: tenant.id,
    })
    throw stagesError
  }

  const stages = (stageRows ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    hasResultsLink: parseRaceResultsEventId(s.results_url) !== null,
  }))

  const selectedStageId = stages.some((s) => s.id === stageParam) ? stageParam : undefined

  // Everything rendered per row comes from THIS query. OFF-01 fetches its
  // expanded detail with a Promise.all over the whole roster and says in a
  // comment that this is only defensible at 10-15 rows; a participant list
  // is larger, so that pattern is deliberately not copied.
  //
  // The stage filter goes through the link table with an inner join, which
  // is also why participant_stages carries its own tenant_id.
  let query = supabase
    .from('participants')
    .select(
      selectedStageId
        ? 'id, name, bib, category, club, nation, gender, phone, source, extra, withdrawn_at, participant_stages!inner(stage_id)'
        : 'id, name, bib, category, club, nation, gender, phone, source, extra, withdrawn_at, participant_stages(stage_id)'
    )
    .eq('tenant_id', tenant.id)
    // N23: this event's participants.
    .eq('event_id', eventId)

  if (selectedStageId) {
    query = query.eq('participant_stages.stage_id', selectedStageId)
  }

  // Withdrawn participants are hidden by default — they are the exception,
  // and a roster that shows struck entries alongside active ones invites
  // staffing decisions against people who are no longer racing.
  if (!showWithdrawn) {
    query = query.is('withdrawn_at', null)
  }

  const { data: participantRows, error } = await query
    .order('bib', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .range(from, to)

  if (error) {
    logQueryError(error, {
      op: 'admin/participants',
      table: 'participants',
      kind: 'select',
      tenantId: tenant.id,
      extra: { page, stageId: selectedStageId ?? null },
    })
    throw error
  }

  const fetched = participantRows ?? []
  // pageRange asks for one row past the page's end; it is never rendered,
  // it only answers "is there a next page" without a second count query.
  const hasMore = fetched.length > PARTICIPANTS_PAGE_SIZE
  const pageRows = hasMore ? fetched.slice(0, PARTICIPANTS_PAGE_SIZE) : fetched

  checkReadCeiling(fetched, {
    ceiling: PARTICIPANTS_CEILING,
    page: 'admin/participants',
    message: 'Participants list hit its read ceiling — the list is truncated',
    context: { tenantId: tenant.id },
  })

  const participants = pageRows.map((p) => ({
    id: p.id,
    name: p.name,
    bib: p.bib,
    category: p.category,
    club: p.club,
    nation: p.nation,
    gender: p.gender,
    phone: p.phone,
    source: p.source,
    extra: (p.extra ?? {}) as Record<string, string>,
    withdrawnAt: p.withdrawn_at,
    stageIds: ((p.participant_stages ?? []) as unknown as Array<{ stage_id: string }>).map(
      (link) => link.stage_id
    ),
  }))

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <ParticipantsList
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={eventId}
        participants={participants}
        stages={stages}
        page={page}
        hasMore={hasMore}
        selectedStageId={selectedStageId ?? null}
        showWithdrawn={showWithdrawn}
      />
    </div>
  )
}
