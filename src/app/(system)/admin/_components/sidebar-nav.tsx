'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutPanelLeft, LogOut } from 'lucide-react'
import { LogoutButton } from '@/components/logout-button'

interface Props {
  labels: {
    tenants: string
    logOut: string
  }
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
  // Excludes /admin/health: it's reached via a link from the tenant list
  // (SYS-03), not a sidebar tab, so this is the first admin route where
  // highlighting "Tenants" would be wrong.
  const isActive =
    pathname === '/admin' ||
    (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/health'))

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <nav className="flex-1 overflow-y-auto py-2">
        <Link
          href="/admin"
          aria-current={isActive ? 'page' : undefined}
          className={`flex items-center gap-3 px-6 py-2.5 text-[15px] transition-colors ${
            isActive ? ACTIVE_ITEM : IDLE_ITEM
          }`}
        >
          <LayoutPanelLeft className="size-[18px] shrink-0" strokeWidth={1.5} />
          {labels.tenants}
        </Link>
      </nav>
      <div className="border-t border-edge-soft py-2">
        <LogoutButton className="flex w-full items-center gap-3 px-6 py-2.5 text-left text-[15px] text-ink-soft transition-colors hover:bg-gray-50 hover:text-ink">
          <LogOut className="size-[18px] shrink-0" strokeWidth={1.5} />
          {labels.logOut}
        </LogoutButton>
      </div>
    </div>
  )
}
