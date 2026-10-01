'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Calendar, House, Info, User } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  tenantSlug: string
  // False when the caller has no `officials` row in this tenant, so ACCT-01
  // would answer notFound() — see hasAccountScreen in lib/auth/tenant.
  showAccount: boolean
}

export function BottomTabBar({ tenantSlug, showAccount }: Props) {
  const pathname = usePathname()
  const { t } = useTranslation('official')

  const tabs = [
    { href: `/${tenantSlug}/home`, label: t('nav.home'), Icon: House },
    { href: `/${tenantSlug}/schedule`, label: t('nav.mySchedule'), Icon: Calendar },
    { href: `/${tenantSlug}/event-info`, label: t('nav.eventInfo'), Icon: Info },
    { href: `/${tenantSlug}/announcements`, label: t('nav.announcements'), Icon: Bell },
    ...(showAccount
      ? [{ href: `/${tenantSlug}/account`, label: t('nav.account'), Icon: User }]
      : []),
  ]

  // The height is fixed, not content-derived. Three places assume this bar is
  // 4rem tall — the layout's pb-16 reserve and the account screen's Save bar,
  // which floats at bottom-16 — and when the intrinsic height drifted below
  // that (shorter labels, tighter line box) a gap opened between the Save bar
  // and this one that let page content show through. h-16 makes the shared
  // assumption true.
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 h-16 border-t border-edge bg-white">
      <div className="flex h-full">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                active ? 'text-tenant-primary' : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              {/* The tab icons were hand-drawn in filled/outline pairs so the
                  active one could be solid. The colour already marks it — on
                  both the icon and its label — so the fill was a second signal
                  saying the same thing, and it is what kept this file off the
                  shared icon set. A heavier stroke keeps the active tab
                  distinguishable without relying on colour alone. */}
              <Icon className="size-6" strokeWidth={active ? 2.4 : 1.6} aria-hidden="true" />
              {/* Five tabs share the viewport, so each gets ~75px at 375px wide —
                  less than some labels need ("Evenemangsinfo" against "Event
                  info"). Without min-w-0 the flex item refuses to shrink below its
                  content and the row overflows instead of the label clipping. */}
              <span className="w-full truncate px-0.5 text-center" title={label}>
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
