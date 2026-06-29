import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { publishEvent } from '@/lib/actions/publish-event'

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

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, slug, is_active, tier')
    .eq('slug', tenantSlug)
    .single()
  if (!tenant) notFound()

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

  const { data: event } = await supabase
    .from('events')
    .select('id, name, event_type, start_date, end_date, status, scheduling_granularity_min')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  const { count: stagesCount } = event
    ? await supabase
        .from('event_stages')
        .select('id', { count: 'exact', head: true })
        .eq('event_id', event.id)
    : { count: 0 }

  const { data: officialsData } = await supabase
    .from('officials')
    .select('invite_status')
    .eq('tenant_id', tenant.id)

  const officialsInvited = officialsData?.filter((o) => o.invite_status === 'invited').length ?? 0
  const officialsConfirmed =
    officialsData?.filter((o) => o.invite_status === 'confirmed').length ?? 0

  const hasName = Boolean(event?.name?.trim())
  const hasDates = Boolean(event?.start_date && event?.end_date)
  const hasStage = (stagesCount ?? 0) > 0
  const canPublish = hasName && hasDates && hasStage
  const isPublished = event?.status === 'published'

  // Scheduling warning counts — real values come once scheduling is built
  const overCapacity = 0
  const doubleBooked = 0
  const totalWarnings = overCapacity + doubleBooked

  const tenantId = tenant.id

  async function handlePublish() {
    'use server'
    await publishEvent({ tenantSlug, tenantId, eventId: event!.id })
  }

  function formatDateRange(start: string | null, end: string | null) {
    if (!start || !end) return null
    const s = new Date(start)
    const e = new Date(end)
    const sDay = s.getUTCDate()
    const eDay = e.getUTCDate()
    const sMonth = s.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    const eMonth = e.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    const year = e.getUTCFullYear()
    if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
    return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
  }

  const dateRange = event ? formatDateRange(event.start_date, event.end_date) : null
  const eventName = event?.name?.trim() || 'Untitled event'
  const eventType = event?.event_type?.trim() || null
  const subtitle = [eventType ?? 'Type not set', dateRange ?? 'dates not set'].join(' · ')

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{eventName}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
            isPublished
              ? 'bg-green-50 text-green-700 ring-1 ring-green-600/20'
              : 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20'
          }`}
        >
          {isPublished ? 'Published' : 'Draft'}
        </span>
      </div>

      {/* Row 1: Publish Status + Officials */}
      <div className="grid grid-cols-[3fr_2fr] gap-5 mb-5">
        {/* Publish Status */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Publish Status
          </h2>
          {isPublished ? (
            <p className="text-sm text-gray-700">
              Published — visible to officials and participants.
            </p>
          ) : canPublish ? (
            <>
              <p className="text-sm text-gray-700 mb-5">
                This event is a draft and not yet visible to officials or participants.
              </p>
              <form action={handlePublish}>
                <button
                  type="submit"
                  className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
                >
                  Publish event
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-700 mb-4">
                Cannot publish — required fields are missing:
              </p>
              <ul className="space-y-2.5 mb-5">
                {!hasName && <MissingItem label="Event name" />}
                {!hasDates && <MissingItem label="Event date" />}
                {!hasStage && <MissingItem label="At least one stage" />}
              </ul>
              <button
                disabled
                className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white opacity-40 cursor-not-allowed"
              >
                Publish event
              </button>
            </>
          )}
        </div>

        {/* Officials */}
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Officials
          </h2>
          <div className="flex items-end gap-8">
            <BigStat value={officialsInvited} label="Invited" />
            <BigStat value={officialsConfirmed} label="Confirmed" />
          </div>
        </div>
      </div>

      {/* Row 2: Scheduling Warnings (full width) */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 mb-5">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Scheduling Warnings
          </h2>
          {totalWarnings === 0 ? (
            <span className="inline-flex items-center rounded-full border border-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-500">
              All clear
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              {totalWarnings} issue{totalWarnings !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-end gap-8">
          <BigStat value={overCapacity} label="Over capacity" />
          <BigStat value={doubleBooked} label="Double-booked" />
        </div>
        {totalWarnings > 0 && (
          <div className="mt-5">
            <Link
              href={`/${tenantSlug}/scheduling`}
              className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors"
            >
              Review in Scheduling ›
            </Link>
          </div>
        )}
      </div>

      {/* Admin Areas */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
          Admin Areas
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <NavTile href={`/${tenantSlug}/event`} title="Event configuration" />
          <NavTile href={`/${tenantSlug}/workstations`} title="Workstations" />
          <NavTile href={`/${tenantSlug}/officials`} title="Officials" />
          <NavTile href={`/${tenantSlug}/scheduling`} title="Scheduling" />
          <NavTile href={`/${tenantSlug}/communication`} title="Communication" />
          <NavTile href={`/${tenantSlug}/account`} title="Account" />
        </div>
      </div>
    </div>
  )
}

function MissingItem({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2.5 text-sm text-gray-500">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-300" />
      {label}
    </li>
  )
}

function BigStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  )
}

function NavTile({ href, title }: { href: string; title: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm font-medium text-gray-900 hover:border-gray-300 hover:shadow-sm transition-all"
    >
      <span>{title}</span>
      <span className="text-gray-400">›</span>
    </Link>
  )
}
