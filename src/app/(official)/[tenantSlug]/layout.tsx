import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { BottomTabBar } from './_components/bottom-tab-bar'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

export default async function OfficialLayout({ children, params }: Props) {
  const { tenantSlug } = await params

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  // This layout gates every screen beneath it. The pages also resolve the
  // tenant through the same guarded helper, so the check runs on both — but
  // it is memoised per render pass (F-PERF-07), so it costs one GoTrue round
  // trip and one access-context lookup for the whole render, not two.
  const tenant = await getOfficialTenant(tenantSlug)

  if (!tenant) notFound()

  return (
    <>
      <TenantThemeStyle colorPalette={tenant.color_palette} />
      <div className="flex flex-col min-h-screen bg-white">
        <div className="flex-1 pb-16">{children}</div>
        <BottomTabBar tenantSlug={tenantSlug} />
      </div>
    </>
  )
}
