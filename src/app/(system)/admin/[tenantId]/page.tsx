import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { AppCard } from '@/components/ui/app-card'
import { TenantDetail } from './_components/tenant-detail'

interface Props {
  params: Promise<{ tenantId: string }>
}

export default async function TenantDetailPage({ params }: Props) {
  const { tenantId } = await params

  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const t = await getServerTranslation('en', 'admin')
  const supabase = await createSupabaseServerClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, is_active, tier')
    .eq('id', tenantId)
    .maybeSingle()

  if (!tenant) notFound()

  return (
    <div className="mx-auto max-w-[1240px] px-10 pb-16 pt-8">
      <Link
        href="/admin"
        className="-ml-1 inline-flex items-center gap-1 text-sm font-medium text-ink-label transition-colors hover:text-ink"
      >
        <ChevronLeft className="size-4" strokeWidth={2} />
        {t('systemAdmin.tenants')}
      </Link>

      <h1 className="page-title mb-8 mt-3">{tenant.name}</h1>

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
