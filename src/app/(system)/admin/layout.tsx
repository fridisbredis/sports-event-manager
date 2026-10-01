import { ShieldCheck } from 'lucide-react'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { SidebarNav } from './_components/sidebar-nav'

interface Props {
  children: React.ReactNode
}

export default async function SystemAdminLayout({ children }: Props) {
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'admin')
  const tCommon = await getServerTranslation(language, 'common')

  return (
    <div className="app-surface flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-edge bg-white">
        <div className="flex items-center justify-between border-b border-edge-soft px-6 py-5">
          <span className="section-label">{t('systemAdmin.sidebarLabel')}</span>
          <ShieldCheck className="size-4 shrink-0 text-ink-faint" strokeWidth={2} />
        </div>
        <SidebarNav
          language={language}
          labels={{
            tenants: t('systemAdmin.tenants'),
            logOut: t('systemAdmin.logOut'),
            // From `common`, not `admin`: the same label sits above every
            // other language control in the app.
            language: tCommon('language.label'),
          }}
        />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
