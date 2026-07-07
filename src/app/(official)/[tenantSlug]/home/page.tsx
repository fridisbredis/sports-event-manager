import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getServerTranslation } from '@/lib/i18n/server'

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

function NavCard({
  href,
  title,
  subtitle,
}: {
  href: string
  title: string
  subtitle: string
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-4 hover:bg-gray-50 transition-colors"
    >
      <div className="w-12 h-12 rounded-xl bg-gray-100 shrink-0" />
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
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  const service = await createSupabaseServiceClient()

  const [{ data: official }, { data: event }] = await Promise.all([
    service
      .from('officials')
      .select('name')
      .eq('user_id', user.id)
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
    service
      .from('events')
      .select('name')
      .eq('tenant_id', tenant.id)
      .maybeSingle(),
  ])

  const name = official?.name ?? ''
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
    },
    {
      href: `/${tenantSlug}/schedule`,
      title: t('home.mySchedule'),
      subtitle: t('home.myScheduleSub'),
    },
    {
      href: `/${tenantSlug}/announcements`,
      title: t('home.announcements'),
      subtitle: t('home.announcementsSub'),
    },
    {
      href: `/${tenantSlug}/account`,
      title: t('home.accountTitle'),
      subtitle: t('home.accountSub'),
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
