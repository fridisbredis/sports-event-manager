import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { SidebarNav } from './_components/sidebar-nav'
import { getServerTranslation } from '@/lib/i18n/server'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

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

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, color_palette')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  // Only a tenant_admin of this tenant or a system_admin may pass.
  if (!(await hasAdminAccessToTenant(user.id, tenant.id))) notFound()

  return (
    <>
      <TenantThemeStyle colorPalette={tenant.color_palette ?? 'blue'} />
      <div className="flex min-h-screen bg-gray-50">
        <SidebarNav tenantSlug={tenantSlug} adminLabel={t('navigation.adminLabel')} />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </>
  )
}
