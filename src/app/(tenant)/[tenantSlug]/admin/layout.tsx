import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
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

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // Resolves the tenant only once the caller has passed the admin access check
  // for it, so this layout still gates every page beneath it. Memoised per
  // render pass (F-PERF-07), so the pages below reuse this result instead of
  // repeating the GoTrue round trip and the two access-context queries.
  const tenant = await getAdminTenant(tenantSlug)

  if (!tenant) notFound()

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
