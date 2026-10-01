import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { Bell, Calendar, ChevronRight, Info, User, type LucideIcon } from 'lucide-react'
import { unstable_cache } from 'next/cache'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { defaultLocale } from '@/lib/i18n/config'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { officialHomeCacheTag } from '@/lib/cache/tags'
import { AvatarImage } from '@/components/ui/avatar-image'

interface Props {
  params: Promise<{ tenantSlug: string }>
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
  Icon: LucideIcon
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-4 ${CARD_SURFACE} px-4 py-4 transition-colors hover:bg-surface`}
    >
      {/* The bubble takes the tenant's tint rather than HeroUI's own primary,
          so these follow the palette like every other tinted surface in the
          app. */}
      <div className="flex size-12 shrink-0 items-center justify-center rounded-large bg-tenant-primary-tint text-tenant-primary-tint-text">
        <Icon className="size-6" strokeWidth={1.8} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[17px] font-bold leading-snug text-ink">{title}</p>
        <p className="mt-0.5 text-[15px] leading-snug text-ink-muted">{subtitle}</p>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-faint" aria-hidden="true" />
    </Link>
  )
}

export default async function OfficialHomePage({ params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation(defaultLocale, 'official')

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
      return data as { name: string | null; avatar_url: string | null }
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
  const avatarUrl = officialHome?.avatar_url ?? null
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
      Icon: Info,
    },
    {
      href: `/${tenantSlug}/schedule`,
      title: t('home.mySchedule'),
      subtitle: t('home.myScheduleSub'),
      Icon: Calendar,
    },
    {
      href: `/${tenantSlug}/announcements`,
      title: t('home.announcements'),
      subtitle: t('home.announcementsSub'),
      Icon: Bell,
    },
    {
      href: `/${tenantSlug}/account`,
      title: t('home.accountTitle'),
      subtitle: t('home.accountSub'),
      Icon: User,
    },
  ]

  return (
    <div className="px-5 pt-10 pb-6">
      {/* Greeting. The avatar shares its tokens with the one on ACCT-01 —
          same circle, same initials, so the two screens do not render one
          person's mark two different greys. */}
      <div className="mb-8 flex items-center gap-4">
        <AvatarImage
          src={avatarUrl}
          initials={initials}
          alt={name}
          className="size-14 bg-status-neutral-bg"
          initialsClassName="text-base font-semibold text-ink-soft"
        />
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold leading-snug text-ink">
            {name ? t('home.greeting', { name }) : t('home.greetingAnon')}
          </h1>
          <p className="mt-0.5 text-[15px] text-ink-muted">
            {eventName} · {t('home.eventRole')}
          </p>
        </div>
      </div>

      {/* Nav cards. The heading uses the app-wide .section-label rather than
          restating the rule — it was a semibold gray-400, a shade and a weight
          off from every other section label in the app. */}
      <p className="section-label mb-3">{t('home.goTo')}</p>
      <div className="flex flex-col gap-3">
        {cards.map((card) => (
          <NavCard key={card.href} {...card} />
        ))}
      </div>
    </div>
  )
}
