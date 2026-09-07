import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { officialHomeCacheTag } from '@/lib/cache/tags'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

function ChevronRight() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      className="w-5 h-5 shrink-0 text-gray-400"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
      <path
        fillRule="evenodd"
        d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm8.706-1.442c1.146-.573 2.437.463 2.126 1.706l-.709 2.836.042-.02a.75.75 0 01.67 1.34l-.04.022c-1.147.573-2.438-.463-2.127-1.706l.71-2.836-.042.02a.75.75 0 11-.671-1.34l.041-.022zM12 9a.75.75 0 100-1.5.75.75 0 000 1.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
      <path
        fillRule="evenodd"
        d="M6.75 2.25A.75.75 0 017.5 3v1.5h9V3A.75.75 0 0118 3v1.5h.75a3 3 0 013 3v11.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V7.5a3 3 0 013-3H6V3a.75.75 0 01.75-.75zm13.5 9a1.5 1.5 0 00-1.5-1.5H5.25a1.5 1.5 0 00-1.5 1.5v7.5a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5v-7.5z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
      <path
        fillRule="evenodd"
        d="M5.25 9a6.75 6.75 0 0113.5 0v.75c0 2.123.8 4.057 2.118 5.52a.75.75 0 01-.297 1.206c-1.544.57-3.16.99-4.831 1.243a3.75 3.75 0 11-7.48 0 24.585 24.585 0 01-4.831-1.244.75.75 0 01-.298-1.205A8.217 8.217 0 005.25 9.75V9zm4.502 8.9a2.25 2.25 0 104.496 0 25.057 25.057 0 01-4.496 0z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
      <path
        fillRule="evenodd"
        d="M7.5 6a4.5 4.5 0 119 0 4.5 4.5 0 01-9 0zM3.751 20.105a8.25 8.25 0 0116.498 0 .75.75 0 01-.437.695A18.683 18.683 0 0112 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 01-.437-.695z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function NavCard({
  href,
  title,
  subtitle,
  Icon,
}: {
  href: string
  title: string
  subtitle: string
  Icon: () => React.ReactElement
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 hover:bg-gray-50 transition-colors`}
    >
      <div className="w-12 h-12 rounded-large bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>
      <ChevronRight />
    </Link>
  )
}

export default async function OfficialHomePage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'official')

  const supabase = await createSupabaseServerClient()
  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Memoised per render pass (F-PERF-07): shares one auth resolution and one
  // access check with the layout above instead of repeating both.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  // PERF-06 / F-PERF-04 Phase 1 (ADR-0003): officials read moved behind
  // get_official_home_cached (migration 0050) instead of a direct
  // .from('officials') call. Must be the service-role client — the anon
  // client can't reach this RPC (grant excludes it, see the migration), and
  // the session-cookie client can't run inside unstable_cache at all (no
  // cookies() access there). Safe here only because the RPC is SECURITY
  // DEFINER owned by cache_rpc_reader, a NOBYPASSRLS role — service_role's
  // own BYPASSRLS never applies inside it. Confirmed rows only, newest
  // first, same "re-invited official keeps the old soft-deleted row"
  // reasoning as before — now enforced by the RPC's own WHERE clause rather
  // than this query.
  const getOfficialHomeCached = unstable_cache(
    async (tenantId: string, userId: string) => {
      const service = createSupabaseServiceClient()
      const { data, error } = await service.rpc('get_official_home_cached', {
        p_tenant_id: tenantId,
        p_user_id: userId,
      })
      if (error) throw error
      return data as { name: string | null }
    },
    ['official-home'], // cache namespace, data-shape only — tenant/user
    // scoping comes entirely from the (tenantId, userId) closure arguments
    // reaching both the RPC call above and the tags array below
    {
      tags: [officialHomeCacheTag(tenant.id, user.id)],
      revalidate: 60,
    }
  )

  const [officialHome, { data: event }] = await Promise.all([
    getOfficialHomeCached(tenant.id, user.id),
    supabase.from('events').select('name').eq('tenant_id', tenant.id).maybeSingle(),
  ])

  const name = officialHome?.name ?? ''
  const eventName = event?.name ?? tenantSlug
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  const cards = [
    {
      href: `/${tenantSlug}/event-info`,
      title: t('home.eventInfo'),
      subtitle: t('home.eventInfoSub'),
      Icon: InfoIcon,
    },
    {
      href: `/${tenantSlug}/schedule`,
      title: t('home.mySchedule'),
      subtitle: t('home.myScheduleSub'),
      Icon: CalendarIcon,
    },
    {
      href: `/${tenantSlug}/announcements`,
      title: t('home.announcements'),
      subtitle: t('home.announcementsSub'),
      Icon: BellIcon,
    },
    {
      href: `/${tenantSlug}/account`,
      title: t('home.accountTitle'),
      subtitle: t('home.accountSub'),
      Icon: PersonIcon,
    },
  ]

  return (
    <div className="px-5 pt-10 pb-6">
      {/* Greeting */}
      <div className="flex items-center gap-4 mb-8">
        <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
          {initials ? (
            <span className="text-sm font-semibold text-gray-600">{initials}</span>
          ) : null}
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {name ? t('home.greeting', { name }) : t('home.greetingAnon')}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {eventName} · {t('home.eventRole')}
          </p>
        </div>
      </div>

      {/* Nav cards */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
        {t('home.goTo')}
      </p>
      <div className="flex flex-col gap-3">
        {cards.map((card) => (
          <NavCard key={card.href} {...card} />
        ))}
      </div>
    </div>
  )
}
