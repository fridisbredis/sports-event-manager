import { notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { TenantList } from './_components/tenant-list'
import { checkReadCeiling } from '@/lib/db/bounded-read'

// This is a guard-rail, not pagination: the list grows with the customer
// count, so it must not be unbounded, but it is nowhere near the ceiling.
// Ask for one row past the ceiling so a breach is detectable rather than
// silently truncating the tenant list.
const TENANT_CEILING = 500

export default async function SystemAdminPage() {
  const auth = await requireSystemAdmin()
  if ('error' in auth) notFound()

  const supabase = await createSupabaseServerClient()
  const { data: tenants, error } = await supabase
    .from('tenants')
    .select('id, name, slug, is_active, tier')
    .order('created_at', { ascending: false })
    .range(0, TENANT_CEILING)

  if (error) throw error

  const rows = checkReadCeiling(tenants ?? [], {
    ceiling: TENANT_CEILING,
    page: '(system)/admin',
    message: 'Tenant list hit its read ceiling — the list is truncated',
  })

  return <TenantList tenants={rows} />
}
