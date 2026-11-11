'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { Bell, House, Info, User } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { participantEventInfoPath, participantPath } from '@/lib/events/paths'

interface Props {
  tenantSlug: string
  // The event the Event info tab opens: the caller's only event. null when
  // they are entered in several, which sends the tab to PAR-01, where each
  // event block links to its own info.
  soleEventId: string | null
}

// N43: the participant counterpart of the official BottomTabBar, with the
// same tap behaviour (the highlight moves on the tap, see the comment there).
// Announcements (ANN-02, N44) is tenant-wide like Home, so it needs no event.
export function ParticipantTabBar({ tenantSlug, soleEventId }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation('official')
  const [, startTransition] = useTransition()
  const [shownPath, setShownPath] = useOptimistic(pathname)

  const home = participantPath(tenantSlug)
  const tabs = [
    { id: 'home', href: home, label: t('participant.nav.home'), Icon: House },
    {
      id: 'event-info',
      href: soleEventId ? participantEventInfoPath(tenantSlug, soleEventId) : home,
      label: t('participant.nav.eventInfo'),
      Icon: Info,
    },
    {
      id: 'announcements',
      href: participantPath(tenantSlug, 'announcements'),
      label: t('participant.nav.announcements'),
      Icon: Bell,
    },
    {
      id: 'account',
      href: participantPath(tenantSlug, 'account'),
      label: t('participant.nav.account'),
      Icon: User,
    },
  ]

  // Home is a prefix of every other participant path, so it matches exactly;
  // the others also match their sub-paths.
  const isOn = (path: string, id: string, href: string) =>
    id === 'home' ? path === href : path === href || path.startsWith(href + '/')

  return (
    // h-16 for the same reason as the official bar: the layout's pb-16 and the
    // account screen's Save bar both assume it.
    <nav className="fixed bottom-0 inset-x-0 z-40 h-16 border-t border-edge bg-white">
      <div className="flex h-full">
        {tabs.map(({ id, href, label, Icon }) => {
          // With several events the Event info tab leads home; it is not lit
          // there, since home is not event info.
          const leadsHome = id !== 'home' && href === home
          const active = !leadsHome && isOn(shownPath, id, href)
          const committed = !leadsHome && isOn(pathname, id, href)
          return (
            <Link
              key={id}
              href={href}
              aria-current={committed ? 'page' : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                e.preventDefault()
                startTransition(() => {
                  setShownPath(href)
                  router.push(href)
                })
              }}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                active ? 'text-tenant-primary' : 'text-ink-faint hover:text-ink-soft'
              }`}
            >
              <Icon className="size-6" strokeWidth={active ? 2.4 : 1.6} aria-hidden="true" />
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
