'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  tenantSlug: string
}

export function SidebarNav({ tenantSlug }: Props) {
  const pathname = usePathname()
  const { t } = useTranslation('admin')

  const navItems = [
    { segment: 'dashboard', label: t('navigation.dashboard') },
    { segment: 'event', label: t('navigation.eventConfig') },
    { segment: 'workstations', label: t('navigation.workstations') },
    { segment: 'officials', label: t('navigation.officials') },
    { segment: 'scheduling', label: t('navigation.scheduling') },
    { segment: 'communication', label: t('navigation.communication') },
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
        {navLink('account', t('navigation.account'))}
      </div>
    </div>
  )
}
