import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import OfficialsList from './_components/officials-list'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { fetchOfficialDetail, type OfficialDetail } from '@/lib/scheduling/official-detail'
import { getUserLanguage } from '@/lib/i18n/user-language'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// A guard-rail, not pagination. A confirmed typical tenant runs 10-15
// officials (quality-requirements.md:113), so this ceiling should never be
// reached; asking for one row past it makes a breach visible in the logs
// instead of silently shortening the roster.
const OFFICIALS_CEILING = 500

export default async function OfficialsPage({ params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): the layout above already
  // resolved and authorized this tenant, so this reuses that result
  // instead of repeating the GoTrue round trip and the access-context
  // queries. The check still runs for this page — it is not skipped.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

  const { data: officials, error } = await supabase
    .from('officials')
    .select(
      'id, name, phone, invite_status, user_id, created_at, tenant_id, sms_opt_out, avatar_url'
    )
    .eq('tenant_id', tenant.id)
    .neq('invite_status', 'removed')
    .order('created_at', { ascending: true })
    .range(0, OFFICIALS_CEILING)

  if (error) throw error

  const rows = checkReadCeiling(officials ?? [], {
    ceiling: OFFICIALS_CEILING,
    page: 'admin/officials',
    message: 'Officials roster hit its read ceiling — the list is truncated',
    context: { tenantId: tenant.id },
  })

  // N17's expanded row. Read up front for the whole roster rather than on
  // demand per row, because a confirmed typical tenant runs 10-15 officials
  // (quality-requirements.md:113) — two small indexed reads each, issued
  // together, against a roster that size. That keeps the disclosure instant
  // and avoids a server action per expand.
  //
  // If the roster ever grows past that, this is the line to revisit: the
  // OFFICIALS_CEILING above admits up to 500, and 1000 round trips would be
  // the wrong shape. The ceiling logs before that point is reached.
  const visible = rows.filter((o) => o.invite_status !== 'removed')
  const language = await getUserLanguage()

  const details = new Map<string, OfficialDetail>(
    await Promise.all(
      visible.map(
        async (o) =>
          [
            o.id,
            await fetchOfficialDetail(supabase, { tenantId: tenant.id, officialId: o.id }),
          ] as const
      )
    )
  )

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <OfficialsList
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        officials={rows}
        currentUserId={user.id}
        details={Object.fromEntries(details)}
        language={language}
      />
    </div>
  )
}
