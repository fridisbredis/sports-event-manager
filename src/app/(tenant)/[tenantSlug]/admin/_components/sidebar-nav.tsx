'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

interface Props {
  tenantSlug: string
}

export function SidebarNav({ tenantSlug }: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useTranslation('admin')

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navItems = [
    { segment: 'admin/dashboard', label: t('navigation.dashboard') },
    { segment: 'admin/event', label: t('navigation.eventConfig') },
    { segment: 'admin/workstations', label: t('navigation.workstations') },
    { segment: 'admin/officials', label: t('navigation.officials') },
    { segment: 'admin/scheduling', label: t('navigation.scheduling') },
    { segment: 'admin/communication', label: t('navigation.communication') },
  ]

  const navLink = (segment: string, label: string) => {
    const href = `/${tenantSlug}/${segment}`
    const isActive = pathname === href || pathname.startsWith(href + '/')
    return (
      <Link
        key={segment}
        href={href}
        className={`block px-6 py-2.5 text-sm transition-colors ${
          isActive
            ? 'bg-gray-100 text-gray-900 font-medium'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
      >
        {label}
      </Link>
    )
  }

  return (
    <div className="flex flex-col flex-1">
      <nav className="py-2 flex-1">{navItems.map((item) => navLink(item.segment, item.label))}</nav>
      <div className="border-t border-gray-100 py-2">
        {navLink('admin/account', t('navigation.account'))}
        <button
          onClick={handleLogout}
          className="block w-full text-left px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          Log out
        </button>
      </div>
    </div>
  )
}
