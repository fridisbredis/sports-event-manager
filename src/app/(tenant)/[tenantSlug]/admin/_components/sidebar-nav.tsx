'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  LayoutDashboard,
  CalendarDays,
  MapPin,
  Users,
  CalendarClock,
  MessageSquare,
  UserCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  tenantSlug: string
  adminLabel: string
}

const COLLAPSE_STORAGE_KEY = 'admin-sidebar-collapsed'

export function SidebarNav({ tenantSlug, adminLabel }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation('admin')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true')
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next))
      return next
    })
  }

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems: { segment: string; label: string; icon: LucideIcon }[] = [
    { segment: 'admin/dashboard', label: t('navigation.dashboard'), icon: LayoutDashboard },
    { segment: 'admin/event', label: t('navigation.eventConfig'), icon: CalendarDays },
    { segment: 'admin/workstations', label: t('navigation.workstations'), icon: MapPin },
    { segment: 'admin/officials', label: t('navigation.officials'), icon: Users },
    { segment: 'admin/scheduling', label: t('navigation.scheduling'), icon: CalendarClock },
    { segment: 'admin/communication', label: t('navigation.communication'), icon: MessageSquare },
  ]

  const navLink = (segment: string, label: string, Icon: LucideIcon) => {
    const href = `/${tenantSlug}/${segment}`
    const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link
        key={segment}
        href={href}
        title={collapsed ? label : undefined}
        className={`flex items-center gap-3 px-6 py-2.5 text-sm transition-colors ${
          collapsed ? 'justify-center px-0' : ''
        } ${
          isActive
            ? 'bg-gray-100 text-gray-900 font-medium'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        <Icon className="size-4 shrink-0" strokeWidth={2} />
        {!collapsed && label}
      </Link>
    )
  }

  return (
    <aside
      className={`sticky top-0 shrink-0 border-r border-gray-200 bg-white flex flex-col h-screen transition-[width] duration-150 ${
        collapsed ? 'w-16' : 'w-56'
      }`}
    >
      <div
        className={`flex items-center border-b border-gray-100 px-6 py-5 ${
          collapsed ? 'justify-center px-0' : 'justify-between'
        }`}
      >
        {!collapsed && (
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            {adminLabel}
          </span>
        )}
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
      <div className="flex flex-col flex-1 min-h-0">
        <nav className="py-2 flex-1 overflow-y-auto">
          {navItems.map((item) => navLink(item.segment, item.label, item.icon))}
        </nav>
        <div className="border-t border-gray-100 py-2">
          {navLink('admin/account', t('navigation.account'), UserCircle)}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Log out' : undefined}
            className={`flex w-full items-center gap-3 text-left px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors ${
              collapsed ? 'justify-center px-0' : ''
            }`}
          >
            <LogOut className="size-4 shrink-0" strokeWidth={2} />
            {!collapsed && 'Log out'}
          </button>
        </div>
      </div>
    </aside>
  )
}
