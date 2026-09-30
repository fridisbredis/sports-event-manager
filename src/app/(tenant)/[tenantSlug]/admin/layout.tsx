import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getAdminTenant } from '@/lib/auth/tenant'
import { SidebarNav } from './_components/sidebar-nav'
import { getServerTranslation } from '@/lib/i18n/server'
import { defaultLocale } from '@/lib/i18n/config'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

export default async function TenantLayout({ children, params }: Props) {
  const { tenantSlug } = await params
  const t = await getServerTranslation(defaultLocale, 'admin')

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
      <div className="app-surface flex min-h-screen">
        <SidebarNav tenantSlug={tenantSlug} adminLabel={t('navigation.adminLabel')} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  )
}
