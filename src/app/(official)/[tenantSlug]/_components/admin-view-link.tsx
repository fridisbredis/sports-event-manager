'use client'

import Link from 'next/link'
import { ArrowUpRight, LayoutDashboard } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  tenantSlug: string
}

// Only rendered for callers who pass the admin access check for this tenant
// (see hasAdminScreens) — an official never sees it.
//
// Not a sixth tab in BottomTabBar: that row already gives five tabs ~75px
// each at 375px wide, and this is a surface switch rather than a peer of the
// official's own screens. A full-width strip above the content reads as
// "you are also an admin here" without taking space from them.
export function AdminViewLink({ tenantSlug }: Props) {
  const { t } = useTranslation('official')

  return (
    <div className="border-b border-edge bg-gray-50">
      <Link
        href={`/${tenantSlug}/admin/dashboard`}
        className="flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <LayoutDashboard className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="truncate">{t('nav.adminView')}</span>
        <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </div>
  )
}
