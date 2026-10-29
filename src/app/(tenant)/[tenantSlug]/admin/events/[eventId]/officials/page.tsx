import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import OfficialsList from './_components/officials-list'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { fetchOfficialDetail, type OfficialDetail } from '@/lib/scheduling/official-detail'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { listTenantAdmins } from '@/lib/auth/tenant-admins'
import { maxTenantAdmins } from '@/lib/tiers/features'

interface Props {
  params: Promise<{ tenantSlug: string; eventId: string }>
}

// A guard-rail, not pagination. A confirmed typical tenant runs 10-15
// officials (quality-requirements.md:113), so this ceiling should never be
// reached; asking for one row past it makes a breach visible in the logs
// instead of silently shortening the roster.
const OFFICIALS_CEILING = 500

export default async function OfficialsPage({ params }: Props) {
  const { tenantSlug, eventId } = await params

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
    // N23: this event's officials — members in official_events — not the
    // whole tenant's. The embedded membership is only a filter.
    .select(
      'id, name, phone, invite_status, user_id, created_at, tenant_id, sms_opt_out, avatar_url, official_events!inner(event_id)'
    )
    .eq('tenant_id', tenant.id)
    .eq('official_events.event_id', eventId)
    .neq('invite_status', 'removed')
    .order('created_at', { ascending: true })
    .range(0, OFFICIALS_CEILING)

  if (error) throw error

  // N23 (7c): the tenant's other officials, with the events they are in, for
  // "From other events". Everyone not removed and not already in this event.
  const { data: tenantOfficials, error: candidatesError } = await supabase
    .from('officials')
    .select('id, name, phone, invite_status, official_events(event_id, events(name))')
    .eq('tenant_id', tenant.id)
    .neq('invite_status', 'removed')
    .order('name', { ascending: true })
    .range(0, OFFICIALS_CEILING)

  if (candidatesError) throw candidatesError

  const candidates = (tenantOfficials ?? [])
    .filter((o) => !o.official_events.some((m) => m.event_id === eventId))
    .map((o) => ({
      id: o.id,
      name: o.name,
      phone: o.phone,
      invite_status: o.invite_status,
      events: o.official_events.flatMap((m) => (m.events ? [m.events.name] : [])),
    }))

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

  // N27: who on the roster is an admin, and the tier's cap. Every
  // tenant_admin row counts toward the cap, locked-out ones included —
  // grant_tenant_admin counts them the same way, so a button enabled here is
  // one the RPC will not refuse for being full.
  const admins = await listTenantAdmins(tenant.id, tenant.tier)
  const adminUserIds = admins.map((a) => a.userId)
  const adminCap = maxTenantAdmins(tenant.tier)

  const details = new Map<string, OfficialDetail>(
    await Promise.all(
      visible.map(
        async (o) =>
          [
            o.id,
            await fetchOfficialDetail(supabase, { tenantId: tenant.id, eventId, officialId: o.id }),
          ] as const
      )
    )
  )

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <OfficialsList
        tenantSlug={tenantSlug}
        tenantId={tenant.id}
        eventId={eventId}
        officials={rows}
        currentUserId={user.id}
        details={Object.fromEntries(details)}
        language={language}
        adminUserIds={adminUserIds}
        adminCap={adminCap}
        tier={tenant.tier}
        candidates={candidates}
      />
    </div>
  )
}
