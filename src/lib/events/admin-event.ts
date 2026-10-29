import { cache } from 'react'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getAdminTenant } from '@/lib/auth/tenant'

const eventIdSchema = z.string().uuid()

export type AdminEvent = {
  id: string
  tenant_id: string
  status: string
}

// N23: the event named in an admin URL, or null when it is not one of this
// tenant's events (or the caller is not this tenant's admin). The layout at
// admin/events/[eventId] turns null into a 404, so a page beneath it can rely
// on the event belonging to the tenant without checking again.
//
// Two layers, per CLAUDE.md's defence in depth: getAdminTenant is the app's
// admin check, and the read goes through the RLS client filtered on the
// tenant as well, so neither a forged event id from another tenant nor a gap
// in one layer is enough. Memoised per render pass like getAdminTenant.
export const getAdminEvent = cache(
  async (tenantSlug: string, eventId: string): Promise<AdminEvent | null> => {
    if (!eventIdSchema.safeParse(eventId).success) return null

    const tenant = await getAdminTenant(tenantSlug)
    if (!tenant) return null

    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase
      .from('events')
      .select('id, tenant_id, status')
      .eq('id', eventId)
      .eq('tenant_id', tenant.id)
      .maybeSingle()

    if (error) throw error
    return data
  }
)

// The event a pre-N23 admin link (/admin/dashboard and the like) opens, since
// it names no event: the latest non-archived by start date, falling back to
// an archived one so a tenant whose only event is archived still reaches it.
// null when the tenant has no events at all. Everything else starts from
// TEN-01's event list at /admin.
export const getDefaultAdminEventId = cache(async (tenantSlug: string): Promise<string | null> => {
  const tenant = await getAdminTenant(tenantSlug)
  if (!tenant) return null

  const supabase = await createSupabaseServerClient()
  const latest = (includeArchived: boolean) => {
    let query = supabase.from('events').select('id').eq('tenant_id', tenant.id)
    if (!includeArchived) query = query.neq('status', 'archived')
    return query
      .order('start_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  const active = await latest(false)
  if (active.error) throw active.error
  if (active.data) return active.data.id

  const any = await latest(true)
  if (any.error) throw any.error
  return any.data?.id ?? null
})
