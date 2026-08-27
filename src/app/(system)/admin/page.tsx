import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { TenantList } from './_components/tenant-list'

export default async function SystemAdminPage() {
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const supabase = await createSupabaseServerClient()
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, name, slug, is_active, tier')
    .order('created_at', { ascending: false })

  if (error) throw error

  return <TenantList tenants={tenants ?? []} />
}
