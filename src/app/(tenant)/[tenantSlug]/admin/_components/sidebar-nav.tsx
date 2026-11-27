'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { Drawer, DrawerContent, useDisclosure } from '@heroui/react'
import {
  CalendarRange,
  Settings,
  LayoutDashboard,
  Trophy,
  Flag,
  Users,
  ClipboardList,
  CalendarClock,
  MessageSquare,
  MessageSquareText,
  Smartphone,
  UserCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  CircleHelp,
  ShieldCheck,
  Building2,
  ChevronDown,
  Ellipsis,
  type LucideIcon,
} from 'lucide-react'
import { PremiumBadge } from '@/components/ui/premium-badge'
import { useTranslation } from '@/lib/i18n/client'
import { LogoutButton } from '@/components/logout-button'
import type { OwnTenantLink } from '@/lib/navigation/own-tenant-links'

interface Props {
  tenantSlug: string
  adminLabel: string
  // False when the caller has no `officials` row in this tenant, so ACCT-01
  // has nothing to show them — see hasAccountScreen in lib/auth/tenant.
  showAccount: boolean
  // False on Standard (N21). Participants is then still listed, marked
  // Premium, but greyed out and not a link. The page and its server actions
  // enforce the same tier independently.
  showParticipants: boolean
  // B19: true when the caller also holds system_admin. The way back to /admin,
  // which an app on the home screen otherwise has no address bar to reach.
  showSystemAdmin: boolean
  /** B20: the user's other tenants, where they hold a role of their own. */
  otherTenants: OwnTenantLink[]
}

const COLLAPSE_STORAGE_KEY = 'admin-sidebar-collapsed'

export function SidebarNav({
  tenantSlug,
  adminLabel,
  showAccount,
  showParticipants,
  showSystemAdmin,
  otherTenants,
}: Props) {
  const pathname = usePathname()
  // N23: the event-scoped links follow the event in the URL. On a
  // tenant-level screen (TEN-01's event list, Settings, Account) there is no
  // event to point them at, so only the tenant links show; the list is the
  // way in.
  const { eventId } = useParams<{ eventId?: string }>()
  const { t } = useTranslation('admin')
  const [collapsed, setCollapsed] = useState(false)
  // Drawer state for the phone menu. Separate from `collapsed`, which is the
  // desktop rail's own width preference and is persisted; this is transient.
  const menu = useDisclosure()

  useEffect(() => {
    // Must run after mount, not during a lazy useState initializer: localStorage
    // isn't available during SSR, so reading it there would make the client's
    // hydration render disagree with the server-rendered HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true')
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
      return next
    })
  }

  const eventBase = `admin/events/${eventId}`

  // N67: the support items (Account, Help and guide, Official view, System
  // admin, Log out) fold into one row. Used now and then, so they start
  // collapsed on every page load — no storage, decided with Peter. Only
  // Account and Help live inside this admin area, so only they can be the
  // current page; the other three leave it.
  const supportGroupId = useId()
  const isUnder = (segment: string) => {
    const href = `/${tenantSlug}/${segment}`
    return pathname === href || pathname.startsWith(href + '/')
  }
  const onFeedback = isUnder('admin/feedback')
  const supportActive =
    (showAccount && isUnder('admin/account')) ||
    (!!eventId && isUnder(`${eventBase}/help`)) ||
    onFeedback
  // N71: Feedback is tenant-level (like Account), so the event and the page
  // the admin came from ride along in the query — a bug report then says
  // where it happened. Left off when already on the page: the current page
  // would only overwrite the original origin with the feedback page itself.
  const feedbackSearch = onFeedback
    ? ''
    : `?${new URLSearchParams({ from: pathname, ...(eventId ? { event: eventId } : {}) })}`
  // Opens itself when the page is one of its items, so the highlighted link
  // is never hidden. Adjusted during render rather than in an effect (React's
  // "storing information from previous renders" pattern): the sidebar lives
  // in the layout and survives client navigation, so arriving at Account from
  // a link elsewhere must open it too, without a collapsed first paint.
  const [supportOpen, setSupportOpen] = useState(supportActive)
  const [prevSupportActive, setPrevSupportActive] = useState(supportActive)
  if (supportActive !== prevSupportActive) {
    setPrevSupportActive(supportActive)
    if (supportActive) setSupportOpen(true)
  }
  const navItems: {
    segment: string
    label: string
    icon: LucideIcon
    badge?: string
    locked?: boolean
  }[] = eventId
    ? [
        {
          segment: `${eventBase}/dashboard`,
          label: t('navigation.dashboard'),
          icon: LayoutDashboard,
        },
        { segment: `${eventBase}/event`, label: t('navigation.eventConfig'), icon: Trophy },
        { segment: `${eventBase}/workstations`, label: t('navigation.workstations'), icon: Flag },
        { segment: `${eventBase}/officials`, label: t('navigation.officials'), icon: Users },
        // Listed on every tier and marked Premium, so a Standard admin can see
        // what Premium adds. On Standard it is locked: greyed out, not a link.
        {
          segment: `${eventBase}/participants`,
          label: t('navigation.participants'),
          icon: ClipboardList,
          badge: t('dashboard.premiumBadge'),
          locked: !showParticipants,
        },
        {
          segment: `${eventBase}/scheduling`,
          label: t('navigation.scheduling'),
          icon: CalendarClock,
        },
        {
          segment: `${eventBase}/communication`,
          label: t('navigation.communication'),
          icon: MessageSquare,
        },
      ]
    : []

  // `isCollapsed` is a parameter rather than the closed-over `collapsed`: the
  // drawer always shows labels, whatever width the desktop rail is set to.
  const navLink = (
    segment: string,
    label: string,
    Icon: LucideIcon,
    {
      isCollapsed = false,
      onNavigate,
      exact = false,
      badge,
      locked = false,
      search = '',
    }: {
      isCollapsed?: boolean
      onNavigate?: () => void
      exact?: boolean
      badge?: string
      locked?: boolean
      /** A query string (with its "?") for the link only; the active match ignores it. */
      search?: string
    } = {}
  ) => {
    const href = `/${tenantSlug}/${segment}`

    // A tier-locked item: shown, not a link. aria-disabled so screen readers
    // announce it as unavailable, and the tooltip says which tier unlocks it.
    if (locked) {
      const lockedHint = t('settings.colorThemeLocked', { tier: t('systemAdmin.premium') })
      return (
        <div
          key={segment}
          role="link"
          aria-disabled="true"
          title={isCollapsed ? `${label} · ${lockedHint}` : lockedHint}
          className={`flex cursor-not-allowed select-none items-center gap-3 px-6 py-2.5 text-[15px] text-ink-faint ${
            isCollapsed ? 'justify-center px-0' : ''
          }`}
        >
          <Icon className="size-[18px] shrink-0" strokeWidth={1.5} />
          {!isCollapsed && <span className="truncate">{label}</span>}
          {!isCollapsed && badge && <PremiumBadge label={badge} className="ml-auto" />}
        </div>
      )
    }

    // `exact` for "All events": /admin is a prefix of every admin screen, so
    // a prefix match would light it up everywhere.
    const isActive = pathname === href || (!exact && pathname.startsWith(href + '/'))
    return (
      <Link
        key={segment}
        href={`${href}${search}`}
        title={isCollapsed ? label : undefined}
        aria-current={isActive ? 'page' : undefined}
        // Closes the drawer on tap. Not left to a route-change effect: tapping
        // the link you are already on is a no-op navigation, so the drawer
        // would stay open with nothing happening behind it.
        onClick={onNavigate}
        className={`flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors ${
          isCollapsed ? 'justify-center px-0' : ''
        } ${isActive ? 'font-semibold' : 'text-ink-soft hover:bg-gray-50 hover:text-ink'}`}
        // The active item takes the tenant's primary tint with a 3px inset bar
        // in the primary colour, per the design handoff. Inline because the
        // values are per-tenant CSS variables, not fixed Tailwind colours.
        style={
          isActive
            ? {
                backgroundColor: 'hsl(var(--tenant-primary-tint))',
                color: 'hsl(var(--tenant-primary-tint-text))',
                boxShadow: 'inset 3px 0 0 hsl(var(--tenant-primary))',
              }
            : undefined
        }
      >
        <Icon className="size-[18px] shrink-0" strokeWidth={1.5} />
        {/* Widened to w-64 for the Swedish labels; `truncate` with a title
            attribute is the backstop for any locale longer still, so a long
            label clips with a tooltip instead of wrapping the row. */}
        {!isCollapsed && (
          <span className="truncate" title={label}>
            {label}
          </span>
        )}
        {/* ml-auto pushes it to the row's right edge. Not shown on the
            collapsed rail, which has room for the icon only. */}
        {!isCollapsed && badge && <PremiumBadge label={badge} className="ml-auto" />}
      </Link>
    )
  }

  // One definition of the nav body, rendered twice: once in the desktop rail
  // and once inside the drawer. Duplicating the list is how the two would
  // quietly drift — a link added to one and not the other.
  const navBody = (opts: { isCollapsed?: boolean; onNavigate?: () => void } = {}) => (
    <div className="flex flex-col flex-1 min-h-0">
      <nav className="py-2 flex-1 overflow-y-auto">
        {navLink('admin', t('navigation.allEvents'), CalendarRange, { ...opts, exact: true })}
        {navLink('admin/settings', t('navigation.settings'), Settings, opts)}
        {navItems.length > 0 && <div className="mx-6 my-2 border-t border-gray-100" />}
        {navItems.map((item) =>
          navLink(item.segment, item.label, item.icon, {
            ...opts,
            badge: item.badge,
            locked: item.locked,
          })
        )}
        {/* B20: the user's other tenants. Without it, someone who is admin in
            two clubs reached only the tenant picked at sign-in; the
            home-screen app has no address bar to type the other into. Never
            active: these leave this tenant. Same shape as the system admin
            menu's "Your tenants" (B19). B21: admin tenants only, the layout
            filters out official-only ones (see SidebarChrome). */}
        {otherTenants.length > 0 && (
          <div className="mt-2 border-t border-gray-100 pt-2">
            {!opts.isCollapsed && (
              <p className="section-label px-6 pb-1 pt-3">{t('navigation.otherOrganisations')}</p>
            )}
            {otherTenants.map((tenant) => (
              <Link
                key={tenant.href}
                href={tenant.href}
                title={opts.isCollapsed ? tenant.name : undefined}
                onClick={opts.onNavigate}
                className={`flex items-center gap-3 px-6 py-2.5 text-[15px] text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink ${
                  opts.isCollapsed ? 'justify-center px-0' : ''
                }`}
              >
                <Building2 className="size-[18px] shrink-0" strokeWidth={1.5} />
                {!opts.isCollapsed && (
                  <span className="truncate" title={tenant.name}>
                    {tenant.name}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </nav>
      <div className="border-t border-gray-100 py-2">
        {/* N67: the toggle. Full width, it is a section header (label and
            chevron, no icon) like "Other organisations": with the person icon
            it read as a menu row and was mistaken for Account, which carries
            the same icon. The icon-only rail has no room for a label, so
            there it is an ellipsis — anything but UserCircle — and expands
            the group in place like the full-width header does. */}
        <button
          type="button"
          onClick={() => setSupportOpen((open) => !open)}
          aria-expanded={supportOpen}
          // The rail and the drawer each render this group, so the id carries
          // which one — two elements must not share it.
          aria-controls={`${supportGroupId}-${opts.onNavigate ? 'drawer' : 'rail'}`}
          aria-label={opts.isCollapsed ? t('navigation.supportMenu') : undefined}
          title={opts.isCollapsed ? t('navigation.supportMenu') : undefined}
          className={`flex w-full items-center gap-3 px-6 text-left transition-colors ${
            opts.isCollapsed
              ? 'justify-center px-0 py-2.5 text-ink-soft hover:bg-gray-50 hover:text-ink'
              : 'pb-1 pt-3 text-ink-faint hover:text-ink'
          }`}
        >
          {opts.isCollapsed ? (
            <Ellipsis className="size-[18px] shrink-0" strokeWidth={1.5} />
          ) : (
            <>
              <span className="section-label truncate">{t('navigation.supportMenu')}</span>
              <ChevronDown
                aria-hidden
                className={`ml-auto size-4 shrink-0 transition-transform duration-150 ${
                  supportOpen ? 'rotate-180' : ''
                }`}
                strokeWidth={1.75}
              />
            </>
          )}
        </button>
        <div id={`${supportGroupId}-${opts.onNavigate ? 'drawer' : 'rail'}`} hidden={!supportOpen}>
          {showAccount && navLink('admin/account', t('navigation.account'), UserCircle, opts)}
          {/* B22: its own page, not the dashboard with ?guide=1 — so it shows
              only the guide and always opens, also from the dashboard. */}
          {eventId && navLink(`${eventBase}/help`, t('navigation.helpGuide'), CircleHelp, opts)}
          {/* N71: next to Help and guide. Shown with or without an event —
              an admin with no event yet may well have a question. */}
          {navLink('admin/feedback', t('navigation.feedback'), MessageSquareText, {
            ...opts,
            search: feedbackSearch,
          })}
          {/* The official surface for this same tenant. Shown to every admin,
              not gated on showAccount: access there comes from the admin role
              (see resolveOfficialSurfaceAccess), while an officials row only
              decides whether their own schedule has anything in it. */}
          {navLink('home', t('navigation.officialView'), Smartphone, opts)}
          {/* Not navLink: that builds /<tenantSlug>/…, and the system admin
              pages live at /admin, outside any tenant. */}
          {showSystemAdmin && (
            <Link
              href="/admin"
              title={opts.isCollapsed ? t('navigation.systemAdminView') : undefined}
              onClick={opts.onNavigate}
              className={`flex items-center gap-3 px-6 py-2.5 text-[15px] text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink ${
                opts.isCollapsed ? 'justify-center px-0' : ''
              }`}
            >
              <ShieldCheck className="size-[18px] shrink-0" strokeWidth={1.5} />
              {!opts.isCollapsed && (
                <span className="truncate" title={t('navigation.systemAdminView')}>
                  {t('navigation.systemAdminView')}
                </span>
              )}
            </Link>
          )}
          <LogoutButton
            title={opts.isCollapsed ? t('navigation.logOut') : undefined}
            className={`flex w-full items-center gap-3 text-left px-6 py-2.5 text-[15px] text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors ${
              opts.isCollapsed ? 'justify-center px-0' : ''
            }`}
          >
            <LogOut className="size-[18px] shrink-0" strokeWidth={1.5} />
            {!opts.isCollapsed && (
              <span className="truncate" title={t('navigation.logOut')}>
                {t('navigation.logOut')}
              </span>
            )}
          </LogoutButton>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Below md only: the rail is hidden there, so this is the whole of the
          admin navigation on a phone. Floating rather than a fixed top bar —
          the mobile schedule is a long scrolling list, and a bar would take a
          permanent slice of a 390px screen to hold one control.
          Bottom-right, not top: within reach of a thumb, clear of the page
          actions that live top-right, and clear of the bottom-LEFT corner,
          which Next.js's dev overlay occupies — that overlay sits above
          everything and swallowed the taps when this was on the left. */}
      <button
        type="button"
        onClick={menu.onOpen}
        aria-label={t('navigation.openMenu')}
        aria-expanded={menu.isOpen}
        className="fixed bottom-5 right-5 z-40 flex size-12 items-center justify-center rounded-full border border-edge bg-white text-ink shadow-modal transition-colors hover:bg-gray-50 md:hidden"
      >
        <Menu className="size-5" strokeWidth={1.75} />
      </button>

      <Drawer
        isOpen={menu.isOpen}
        onOpenChange={menu.onOpenChange}
        placement="left"
        size="xs"
        // The drawer carries the same rail chrome, so it needs the rail's own
        // surface rather than HeroUI's default modal background.
        classNames={{ base: 'bg-white' }}
      >
        <DrawerContent aria-label={t('navigation.adminLabel')}>
          <div className="flex h-full flex-col">
            <div className="flex items-center border-b border-gray-100 px-6 py-5">
              <span className="section-label">{adminLabel}</span>
            </div>
            {navBody({ onNavigate: menu.onClose })}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Hidden below md (N18). The rail is a fixed w-64 that does not shrink, so
        on a 390px phone it left 94px for the page — enough to render the
        content but not to read it, and narrow enough that a truncating heading
        computed to zero width. The drawer above is the phone's navigation. */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-edge bg-white transition-[width] duration-150 md:flex ${
          collapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div
          className={`flex items-center border-b border-gray-100 px-6 py-5 ${
            collapsed ? 'justify-center px-0' : 'justify-between'
          }`}
        >
          {!collapsed && <span className="section-label">{adminLabel}</span>}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="text-gray-400 hover:text-gray-700 transition-colors"
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" strokeWidth={2} />
            ) : (
              <PanelLeftClose className="size-4" strokeWidth={2} />
            )}
          </button>
        </div>
        {navBody({ isCollapsed: collapsed })}
      </aside>
    </>
  )
}
