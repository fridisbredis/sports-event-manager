import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserRoles } from '@/lib/auth/tenant'
import { SidebarNav } from './_components/sidebar-nav'
import { getServerTranslation } from '@/lib/i18n/server'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

export default async function TenantLayout({ children, params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation('en', 'admin')

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const roles = await getUserRoles(user.id)
  const isSystemAdmin = roles.some((r) => r.role === 'system_admin')
  const tenantRole = roles.find((r) => r.tenantSlug === tenantSlug)
  if (!tenantRole && !isSystemAdmin) notFound()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-screen">
        <div className="px-6 py-5 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            {t('navigation.adminLabel')}
          </span>
        </div>
        <SidebarNav tenantSlug={tenantSlug} />
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
