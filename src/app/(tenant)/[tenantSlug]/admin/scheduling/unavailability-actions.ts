'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateActionError as tError } from '@/lib/actions/action-error'

const NOT_AUTHORIZED_KEY = 'actionErrors.notAuthorized'

// Admin-recorded time off. The official's own declaration form lives at
// (official)/[tenantSlug]/availability/actions.ts and writes the same table —
// the two are kept apart because they authorise differently (admin access to
// the tenant versus owning the roster row) and because each may only touch
// rows it created. `created_by_role` carries that ownership and the RLS
// policies enforce it; these actions never write the other role's value.
const setSchema = z.object({
  tenantSlug: z.string().min(1),
  tenantId: z.string().uuid(),
  officialId: z.string().uuid(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
})

export type SetUnavailabilityInput = z.input<typeof setSchema>
export type SetUnavailabilityResult = { error?: string; id?: string }

/**
 * Marks an official as unavailable over a period, on the organisers' behalf.
 *
 * Authorisation is enforced twice, per the project's defense-in-depth rule:
 * RLS gates the write at the database (the tenant_admin_insert policy also
 * requires `created_by_role = 'tenant_admin'`, so this cannot pose as an
 * official's own declaration), and this action independently re-checks admin
 * access to the tenant.
 *
 * Unlike the official's own form this does NOT check that the official is
 * confirmed: an admin marking someone off before they accept their invite is
 * legitimate, and the roster row is what the FK requires.
 */
export async function setUnavailability(
  input: SetUnavailabilityInput
): Promise<SetUnavailabilityResult> {
  const parsed = setSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn('setUnavailability: invalid input', { issues: parsed.error.issues })
    return { error: await tError(NOT_AUTHORIZED_KEY) }
  }

  const { tenantSlug, tenantId, officialId, startsAt, endsAt } = parsed.data

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, tenantId))) {
    return { error: await tError(NOT_AUTHORIZED_KEY) }
  }

  // The DB's CHECK enforces this too; catching it here turns a 23514 into a
  // message that names the actual problem.
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { error: 'scheduling.timeOffEndBeforeStart' }
  }

  const { data, error } = await supabase
    .from('official_unavailability')
    .insert({
      tenant_id: tenantId,
      official_id: officialId,
      // Wall-clock UTC at the DB boundary, matching the project's timestamp
      // convention and the grid's own slot keys.
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      created_by_role: 'tenant_admin',
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) {
    logger.error('setUnavailability: insert failed', error, {
      tenantId,
      officialId,
      startsAt,
      endsAt,
    })
    return { error: 'scheduling.timeOffSaveFailed' }
  }

  revalidatePath(`/${tenantSlug}/admin/scheduling`)

  return { id: data.id }
}

const clearSchema = z.object({
  tenantSlug: z.string().min(1),
  tenantId: z.string().uuid(),
  periodId: z.string().uuid(),
})

export type ClearUnavailabilityInput = z.input<typeof clearSchema>
export type ClearUnavailabilityResult = { error?: string; notOwned?: boolean }

/**
 * Withdraws a period an admin recorded.
 *
 * Cannot remove an official's own declaration — that is the ownership rule,
 * and it is the RLS policy that enforces it rather than a check here: the
 * DELETE matches zero rows and `count` comes back 0. That is reported as
 * `notOwned` so the UI can say why nothing happened, instead of claiming a
 * success that did not occur.
 */
export async function clearUnavailability(
  input: ClearUnavailabilityInput
): Promise<ClearUnavailabilityResult> {
  const parsed = clearSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn('clearUnavailability: invalid input', { issues: parsed.error.issues })
    return { error: await tError(NOT_AUTHORIZED_KEY) }
  }

  const { tenantSlug, tenantId, periodId } = parsed.data

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  if (!(await hasAdminAccessToTenant(user.id, tenantId))) {
    return { error: await tError(NOT_AUTHORIZED_KEY) }
  }

  // `count: 'exact'` is what makes the ownership rule observable: without it a
  // refused delete and a successful one are indistinguishable from here, and
  // the UI would report "removed" for a row that is still there.
  const { error, count } = await supabase
    .from('official_unavailability')
    .delete({ count: 'exact' })
    .eq('id', periodId)
    .eq('tenant_id', tenantId)
    // Belt and braces alongside the RLS policy — and it makes the intent
    // legible at the call site rather than only in the policy.
    .eq('created_by_role', 'tenant_admin')

  if (error) {
    logger.error('clearUnavailability: delete failed', error, { tenantId, periodId })
    return { error: 'scheduling.timeOffDeleteFailed' }
  }

  if (count === 0) {
    return { notOwned: true, error: 'scheduling.timeOffNotOwned' }
  }

  revalidatePath(`/${tenantSlug}/admin/scheduling`)

  return {}
}
