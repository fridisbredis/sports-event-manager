import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { BottomTabBar } from './_components/bottom-tab-bar'

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
    .select('id, slug')
    .eq('slug', tenantSlug)
    .single()

  if (!tenant) notFound()

  const service = await createSupabaseServiceClient()
  const { data: roleRow } = await service
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  if (!roleRow) notFound()

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex-1 pb-16">{children}</div>
      <BottomTabBar tenantSlug={tenantSlug} />
    </div>
  )
}
