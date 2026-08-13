import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canViewOfficialSurfaces } from '@/lib/auth/tenant'
import { BottomTabBar } from './_components/bottom-tab-bar'
import { TenantThemeStyle } from '@/lib/theme/tenant-theme-style'

interface Props {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }>
}

export default async function OfficialLayout({ children, params }: Props) {
  const { tenantSlug } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, color_palette')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  // This layout is the only authorization gate for every screen beneath it —
  // none of the official pages guard themselves. Only an official or
  // tenant_admin of this tenant, or a system_admin, may pass.
  if (!(await canViewOfficialSurfaces(user.id, tenant.id))) notFound()

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
