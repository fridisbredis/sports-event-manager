import { ShieldCheck } from 'lucide-react'
import { getServerTranslation } from '@/lib/i18n/server'
import { defaultLocale } from '@/lib/i18n/config'
import { SidebarNav } from './_components/sidebar-nav'

interface Props {
  children: React.ReactNode
}

export default async function SystemAdminLayout({ children }: Props) {
  const t = await getServerTranslation(defaultLocale, 'admin')

  return (
    <div className="app-surface flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-edge bg-white">
        <div className="flex items-center justify-between border-b border-edge-soft px-6 py-5">
          <span className="section-label">{t('systemAdmin.sidebarLabel')}</span>
          <ShieldCheck className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
        </div>
        <SidebarNav
          labels={{
            tenants: t('systemAdmin.tenants'),
            logOut: t('systemAdmin.logOut'),
          }}
        />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
