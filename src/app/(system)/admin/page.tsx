import { notFound } from 'next/navigation'
import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireSystemAdmin } from '@/lib/auth/tenant'
import { TenantList } from './_components/tenant-list'
import { checkReadCeiling } from '@/lib/db/bounded-read'
import { readAllTenantSmsUsage } from '@/lib/sms/cap'

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

  // N24: this month's SMS spend per tenant, for Peter's point (c) — the
  // system admin half. One query covering every tenant in the list, not one
  // per row.
  //
  // Needs the service client: sms_usage is revoked from `authenticated` and
  // has no SELECT policy, so the RLS-scoped client above cannot read it. The
  // system-admin check has already passed at the top of this page.
  //
  // Null when usage cannot be read, and the column is then omitted entirely
  // rather than showing every tenant at 0 kr — which would look like a quiet
  // month rather than a broken query, and is exactly the wrong thing to show
  // an operator scanning for a tenant about to be cut off.
  const smsUsage = await readAllTenantSmsUsage({
    service: createSupabaseServiceClient(),
    tenants: rows.map((t) => ({ id: t.id, name: t.name, tier: t.tier })),
    op: 'GET /(system)/admin',
  })

  return <TenantList tenants={rows} smsUsage={smsUsage} />
}
