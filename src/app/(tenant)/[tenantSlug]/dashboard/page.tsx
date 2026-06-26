import { redirect, notFound } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function DashboardPage({ params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Tenant
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug, is_active, tier')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  // Verify the user has admin rights for this tenant
  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!roleRow || (roleRow.role !== 'tenant_admin' && roleRow.role !== 'system_admin')) {
    notFound()
  }

  // Event (one per tenant in v1)
  const { data: event } = await supabase
    .from('events')
    .select('id, name, event_type, start_date, end_date, status, scheduling_granularity_min')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  // Event stages count (required for publish)
  const { count: stagesCount } = event
    ? await supabase
        .from('event_stages')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event.id)
    : { count: 0 }

  // Officials counts
  const { data: officialsData } = await supabase
    .from('officials')
    .select('invite_status')
    .eq('tenant_id', tenant.id)

  const officialsInvited = officialsData?.filter((o) => o.invite_status === 'invited').length ?? 0
  const officialsConfirmed =
    officialsData?.filter((o) => o.invite_status === 'confirmed').length ?? 0
  const officialsTotal = officialsData?.length ?? 0

  // Publish requirements
  const hasName = Boolean(event?.name)
  const hasDates = Boolean(event?.start_date && event?.end_date)
  const hasStage = (stagesCount ?? 0) > 0
  const canPublish = hasName && hasDates && hasStage
  const isPublished = event?.status === 'published'

  // Capture tenant.id for the server action (safe: server-side closure)
  const tenantId = tenant.id

  async function handlePublish() {
    'use server'

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) redirect('/login')

    // Re-fetch event and re-verify publish requirements at action time
    const { data: ev } = await supabase
      .from('events')
      .select('id, status, name, start_date, end_date')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (!ev || ev.status === 'published') return

    const { count: stages } = await supabase
      .from('event_stages')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', ev.id)

    // RLS enforces tenant_admin write access; re-check requirements before update
    if (!ev.name || !ev.start_date || !ev.end_date || !stages) return

    await supabase.from('events').update({ status: 'published' }).eq('id', ev.id)

    revalidatePath(`/${tenantSlug}/dashboard`)
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="px-10 py-10 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-10">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{tenant.name}</h1>
          {event && (
            <p className="mt-1 text-sm text-gray-500">
              {event.event_type} · {formatDate(event.start_date)}–{formatDate(event.end_date)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
              isPublished
                ? 'bg-green-50 text-green-700 ring-1 ring-green-600/20'
                : 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20'
            }`}
          >
            {isPublished ? 'Published' : 'Draft'}
          </span>
          {!isPublished && (
            <form action={handlePublish}>
              <button
                type="submit"
                disabled={!canPublish}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Publish
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-5">
        {/* Publish requirements / published summary */}
        <div className="col-span-1 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            {isPublished ? 'Event' : 'Required to publish'}
          </h2>
          {isPublished ? (
            <div className="space-y-3">
              <div className="text-sm text-gray-700">{event?.name}</div>
              {event && (
                <div className="text-sm text-gray-500">
                  {formatDate(event.start_date)} – {formatDate(event.end_date)}
                </div>
              )}
              <div className="text-sm text-gray-500">
                {stagesCount} stage{stagesCount !== 1 ? 's' : ''}
              </div>
            </div>
          ) : (
            <ul className="space-y-2.5">
              <CheckItem ok={hasName} label="Event name" />
              <CheckItem ok={hasDates} label="Date range" />
              <CheckItem ok={hasStage} label="At least one stage/day" />
            </ul>
          )}
          {!isPublished && (
            <p className="mt-5 text-xs text-gray-400 leading-relaxed">
              Publishing makes the event visible to officials and participants.
            </p>
          )}
        </div>

        {/* Officials */}
        <div className="col-span-1 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Officials
          </h2>
          {officialsTotal === 0 ? (
            <p className="text-sm text-gray-400">No officials added yet.</p>
          ) : (
            <ul className="space-y-2.5">
              <StatRow label="Invited" value={officialsInvited} />
              <StatRow label="Confirmed" value={officialsConfirmed} />
              <StatRow label="Total" value={officialsTotal} muted />
            </ul>
          )}
          <div className="mt-5">
            <Link
              href={`/${tenantSlug}/officials`}
              className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
            >
              Manage officials →
            </Link>
          </div>
        </div>

        {/* Scheduling warnings */}
        <div className="col-span-1 rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Schedule
          </h2>
          <ul className="space-y-2.5">
            <StatRow label="Over-capacity" value={0} />
            <StatRow label="Double-booked" value={0} />
          </ul>
          <div className="mt-5">
            <Link
              href={`/${tenantSlug}/scheduling`}
              className="text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2"
            >
              Open scheduling →
            </Link>
          </div>
        </div>
      </div>

      {/* Admin area navigation */}
      <div className="mt-8 grid grid-cols-3 gap-4">
        <NavCard
          href={`/${tenantSlug}/event`}
          title="Event configuration"
          description="Name, dates, stages, venues, facilities"
        />
        <NavCard
          href={`/${tenantSlug}/workstations`}
          title="Workstations"
          description="Staffed posts, capacity, checklists"
        />
        <NavCard
          href={`/${tenantSlug}/officials`}
          title="Officials"
          description="Invite, manage, and track officials"
        />
        <NavCard
          href={`/${tenantSlug}/scheduling`}
          title="Scheduling"
          description="Assign officials to workstations and timeslots"
        />
        <NavCard
          href={`/${tenantSlug}/communication`}
          title="Communication"
          description="Publish announcements to officials and participants"
        />
      </div>
    </div>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'
        }`}
      >
        {ok ? '✓' : '·'}
      </span>
      <span className={ok ? 'text-gray-700' : 'text-gray-400'}>{label}</span>
    </li>
  )
}

function StatRow({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <li className="flex items-center justify-between text-sm">
      <span className={muted ? 'text-gray-400' : 'text-gray-600'}>{label}</span>
      <span className={`font-medium tabular-nums ${muted ? 'text-gray-400' : 'text-gray-900'}`}>
        {value}
      </span>
    </li>
  )
}

function NavCard({
  href,
  title,
  description,
}: {
  href: string
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <div className="text-sm font-medium text-gray-900 group-hover:text-gray-700">{title}</div>
      <div className="mt-1 text-xs text-gray-400 leading-relaxed">{description}</div>
    </Link>
  )
}
