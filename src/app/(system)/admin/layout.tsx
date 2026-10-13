import { ShieldCheck } from 'lucide-react'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { LanguageSelect } from '@/components/language-select'
import { SidebarNav } from './_components/sidebar-nav'

interface Props {
  children: React.ReactNode
}

// The top bar and the sidebar header beside it share a top edge, so their
// bottom borders have to meet. The sidebar header gets its height from px-6
// py-5 around a 12px label, as the tenant-admin one does; the top bar holds a
// taller select, so the same padding would have left it ~16px deeper. It takes
// the height explicitly instead — 2px over the sidebar's 57px, which is what
// looked right against the select rather than a measured match.
const HEADER_BAR = 'h-[59px]'

export default async function SystemAdminLayout({ children }: Props) {
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')

  return (
    <div className="app-surface flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-edge bg-white">
        <div className="flex items-center justify-between border-b border-edge-soft px-6 py-5">
          <span className="section-label">{t('systemAdmin.sidebarLabel')}</span>
          <ShieldCheck className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
        </div>
        <SidebarNav
          labels={{
            tenants: t('systemAdmin.tenants'),
            privacyPolicy: t('systemAdmin.privacyPolicy'),
            logOut: t('systemAdmin.logOut'),
          }}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The language control sits here rather than in the sidebar so it
            reaches every system-admin route, /admin/health and the tenant
            detail page included. The bar carries no heading: the select names
            itself, and a lone label above one control only added a row. */}
        <div
          className={`flex ${HEADER_BAR} shrink-0 items-center justify-end border-b border-edge-soft bg-white px-6`}
        >
          <LanguageSelect current={language} />
        </div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
