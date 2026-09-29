'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bell, Calendar, House, Info, User } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  tenantSlug: string
}

export function BottomTabBar({ tenantSlug }: Props) {
  const pathname = usePathname()
  const { t } = useTranslation('official')

  const tabs = [
    { href: `/${tenantSlug}/home`, label: t('nav.home'), Icon: House },
    { href: `/${tenantSlug}/schedule`, label: t('nav.mySchedule'), Icon: Calendar },
    { href: `/${tenantSlug}/event-info`, label: t('nav.eventInfo'), Icon: Info },
    { href: `/${tenantSlug}/announcements`, label: t('nav.announcements'), Icon: Bell },
    { href: `/${tenantSlug}/account`, label: t('nav.account'), Icon: User },
  ]

  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-edge bg-white">
      <div className="flex">
        {tabs.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
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
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
