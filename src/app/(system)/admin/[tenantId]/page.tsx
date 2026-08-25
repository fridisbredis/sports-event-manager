import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { AppCard } from '@/components/ui/app-card'
import { TenantDetail } from './_components/tenant-detail'

interface Props {
  params: Promise<{ tenantId: string }>
}

export default async function TenantDetailPage({ params }: Props) {
  const { tenantId } = await params

  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const supabase = await createSupabaseServerClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, is_active, tier')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) notFound()

  return (
    <div className="p-8">
      <div className="mb-6">
        <Link
          href="/admin"
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1"
        >
          <span>←</span>
          <span>Tenants</span>
        </Link>
      </div>

      <h1 className="text-2xl font-semibold text-gray-900 mb-8">{tenant.name}</h1>

      <AppCard bodyClassName="p-0 overflow-hidden">
        <TenantDetail
          tenantId={tenant.id}
          isActive={tenant.is_active}
          tier={tenant.tier as 'standard' | 'premium' | 'professional'}
        />
      </AppCard>
    </div>
  )
}
