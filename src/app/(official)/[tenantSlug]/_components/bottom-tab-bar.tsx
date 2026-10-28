'use client'

import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useOptimistic, useTransition } from 'react'
import { Bell, Calendar, House, Info, User } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { officialEventPath } from '@/lib/events/paths'

interface Props {
  tenantSlug: string
  // False when the caller has no `officials` row in this tenant, so ACCT-01
  // would answer notFound() — see hasAccountScreen in lib/auth/tenant.
  showAccount: boolean
  // N23: the event the event tabs open when the URL names none (ACCT-01):
  // the caller's only event. null when they have several or none, which
  // sends those tabs to the event picker instead.
  defaultEventId: string | null
}

export function BottomTabBar({ tenantSlug, showAccount, defaultEventId }: Props) {
  const pathname = usePathname()
  const { eventId: urlEventId } = useParams<{ eventId?: string }>()
  const eventId = urlEventId ?? defaultEventId
  const eventTab = (subpath: string) =>
    eventId ? officialEventPath(tenantSlug, eventId, subpath) : `/${tenantSlug}/events`
  const router = useRouter()
  const { t } = useTranslation('official')
  const [, startTransition] = useTransition()

  // The tab the bar paints as current, which runs ahead of the committed URL.
  //
  // `usePathname` only updates once the navigation commits, so a tap left the
  // previous tab lit while the next route's skeleton was already on screen —
  // the page had visibly moved on and the bar had not. Moving the highlight on
  // the tap keeps the two telling the same story.
  //
  // useOptimistic rather than useState: it reverts to `pathname` on its own
  // when the transition settles, so a navigation that lands somewhere else
  // than asked — a redirect, a notFound, the back button — cannot leave the
  // bar lit on a tab the user is not on.
  const [shownPath, setShownPath] = useOptimistic(pathname)

  const tabs = [
    { href: eventTab('home'), label: t('nav.home'), Icon: House },
    { href: eventTab('event-info'), label: t('nav.eventInfo'), Icon: Info },
    { href: eventTab('schedule'), label: t('nav.mySchedule'), Icon: Calendar },
    { href: eventTab('announcements'), label: t('nav.announcements'), Icon: Bell },
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
          const active = shownPath === href || shownPath.startsWith(href + '/')
          // aria-current follows the committed path, not the optimistic one:
          // announcing the new tab while the previous page is still mounted
          // would misreport where the user is.
          const committed = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              aria-current={committed ? 'page' : undefined}
              onClick={(e) => {
                // Modified clicks (new tab, new window) belong to the browser.
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
