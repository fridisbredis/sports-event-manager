import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { TenantList } from './_components/tenant-list'

export default async function SystemAdminPage() {
  const service = await createSupabaseServiceClient()
  const { data: tenants } = await service
    .from('tenants')
    .select('id, name, slug, is_active, tier')
    .order('created_at', { ascending: false })

  return <TenantList tenants={tenants ?? []} />
}
