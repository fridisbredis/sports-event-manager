'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Drawer, DrawerContent, useDisclosure } from '@heroui/react'
import { Activity, FileText, LayoutPanelLeft, LogOut, Menu, UserCog } from 'lucide-react'
import { LogoutButton } from '@/components/logout-button'

interface Labels {
  tenants: string
  systemAdmins: string
  systemStatus: string
  logOut: string
  privacyPolicy: string
  privacyPolicyNewTab: string
  /** Sidebar heading, repeated as the drawer's own heading. */
  sidebarLabel: string
  openMenu: string
}

interface Props {
  labels: Labels
}

// The system-admin sidebar deliberately does NOT use the tenant theme tint the
// tenant-admin sidebar uses for its active item. This layout sits above every
// tenant and renders no TenantThemeStyle, so --tenant-* is undefined here and a
// tinted row would come out colourless. Graphite is also the right signal: the
// system surface belongs to no single tenant's branding.
const ACTIVE_ITEM = 'bg-status-neutral-bg font-semibold text-ink shadow-[inset_3px_0_0_#111827]'
const IDLE_ITEM = 'text-ink-soft hover:bg-gray-50 hover:text-ink'

export function SidebarNav({ labels }: Props) {
  const pathname = usePathname()
  // Drawer state for the phone menu. The rail is hidden below md, so without
  // this there is no navigation at all on a phone — the same gap the tenant
  // admin screens had before their own drawer.
  const menu = useDisclosure()
  // N28: its own tab. Checked first, because the tenant detail pages live at
  // /admin/<tenantId> and "Tenants" therefore claims every other /admin/ path.
  const systemAdminsActive = pathname.startsWith('/admin/system-admins')
  // SYS-03: its own tab too, for the same reason — "Tenants" would otherwise
  // claim /admin/health as well.
  const systemStatusActive = pathname.startsWith('/admin/health')
  const isActive =
    !systemAdminsActive &&
    !systemStatusActive &&
    (pathname === '/admin' || pathname.startsWith('/admin/'))

  // One definition, rendered twice: in the desktop rail and inside the
  // drawer. A second copy of the links is how the two would drift apart.
  const navBody = (onNavigate?: () => void) => (
    <div className="flex flex-1 flex-col min-h-0">
      <nav className="flex-1 overflow-y-auto py-2">
        <Link
          href="/admin"
          aria-current={isActive ? 'page' : undefined}
          // Closed on tap rather than by a route-change effect: tapping the
          // link for the page you are already on is a no-op navigation and
          // would leave the drawer open over nothing.
          onClick={onNavigate}
          className={`flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors ${
            isActive ? ACTIVE_ITEM : IDLE_ITEM
          }`}
        >
          <LayoutPanelLeft className="size-[18px] shrink-0" strokeWidth={1.5} />
          <span className="truncate" title={labels.tenants}>
            {labels.tenants}
          </span>
        </Link>
        <Link
          href="/admin/system-admins"
          aria-current={systemAdminsActive ? 'page' : undefined}
          onClick={onNavigate}
          className={`flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors ${
            systemAdminsActive ? ACTIVE_ITEM : IDLE_ITEM
          }`}
        >
          <UserCog className="size-[18px] shrink-0" strokeWidth={1.5} />
          <span className="truncate" title={labels.systemAdmins}>
            {labels.systemAdmins}
          </span>
        </Link>
        <Link
          href="/admin/health"
          aria-current={systemStatusActive ? 'page' : undefined}
          onClick={onNavigate}
          className={`flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors ${
            systemStatusActive ? ACTIVE_ITEM : IDLE_ITEM
          }`}
        >
          <Activity className="size-[18px] shrink-0" strokeWidth={1.5} />
          <span className="truncate" title={labels.systemStatus}>
            {labels.systemStatus}
          </span>
        </Link>
      </nav>
      <div className="border-t border-edge-soft py-2">
        {/* System admin has no account screen, so this footer is the only
            place the policy can hang. Styled as an idle nav row rather than a
            tab: it leaves the app, and never takes the active treatment. */}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          // Opens a new tab, so the drawer behind it is closed too — coming
          // back to a still-open drawer over the page would be a surprise.
          onClick={onNavigate}
          className={`flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors ${IDLE_ITEM}`}
        >
          <FileText className="size-[18px] shrink-0" strokeWidth={1.5} />
          <span className="truncate" title={labels.privacyPolicy}>
            {labels.privacyPolicy}
            {/* Visible text is truncated to the sidebar width, so the warning
                goes to screen readers only rather than squeezing the row. */}
            <span className="sr-only"> {labels.privacyPolicyNewTab}</span>
          </span>
        </a>
        <LogoutButton className="flex w-full items-center gap-3 px-6 py-2.5 text-left text-[15px] text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink">
          <LogOut className="size-[18px] shrink-0" strokeWidth={1.5} />
          <span className="truncate" title={labels.logOut}>
            {labels.logOut}
          </span>
        </LogoutButton>
      </div>
    </div>
  )

  return (
    <>
      {/* Below md only. Unlike the tenant admin screens, this layout already
          has a top bar for the language select, so the trigger belongs in it
          rather than floating over the page. */}
      <button
        type="button"
        onClick={menu.onOpen}
        aria-label={labels.openMenu}
        aria-expanded={menu.isOpen}
        className="-ml-1 flex size-9 items-center justify-center rounded-control text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink md:hidden"
      >
        <Menu className="size-5" strokeWidth={1.75} />
      </button>

      <Drawer
        isOpen={menu.isOpen}
        onOpenChange={menu.onOpenChange}
        placement="left"
        size="xs"
        classNames={{ base: 'bg-white' }}
      >
        <DrawerContent aria-label={labels.sidebarLabel}>
          <div className="flex h-full flex-col">
            {/* No shield badge here, unlike the rail's header: HeroUI puts the
                drawer's own close button in this corner, and the two sat on
                top of each other. The heading alone carries the label; the
                badge is decoration and the close button is not. pr-12 keeps
                the text clear of it. */}
            <div className="flex items-center border-b border-edge-soft py-5 pl-6 pr-12">
              <span className="section-label">{labels.sidebarLabel}</span>
            </div>
            {navBody(menu.onClose)}
          </div>
        </DrawerContent>
      </Drawer>

      {/* The rail renders the same body, with no close handler — there is
          nothing to close on desktop. */}
      <div className="hidden flex-1 flex-col md:flex">{navBody()}</div>
    </>
  )
}
