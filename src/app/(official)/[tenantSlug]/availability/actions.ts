'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser, getOfficialTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { toPeriodBounds } from '@/lib/scheduling/period-bounds'

// A declared period, as the form sends it. Dates arrive as `YYYY-MM-DD` and
// times as `HH:MM` rather than as two ISO instants, because that is what the
// form's controls produce and assembling the instant here keeps the
// wall-clock-UTC convention in one place instead of in the browser, where the
// viewer's timezone would leak into it.
const declareSchema = z
  .object({
    tenantSlug: z.string().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // Absent means the whole day: 00:00 on the start date through 00:00 the
    // day after the end date.
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
  })
  // Both times or neither. One alone is ambiguous — "from 09:00 until the end
  // of Sunday" and "all of Saturday until 17:00" are different statements and
  // the form offers no way to tell them apart.
  .refine((v) => (v.startTime === undefined) === (v.endTime === undefined), {
    message: 'partialTimes',
    path: ['endTime'],
  })

export type DeclareUnavailabilityInput = z.input<typeof declareSchema>
export type DeclareUnavailabilityResult = { error?: string; id?: string }

/**
 * Declares a period the calling official is not available to be scheduled.
 *
 * Authorisation is enforced twice, per the project's defense-in-depth rule:
 * RLS gates the write at the database (via is_own_official_row, which also
 * rejects unconfirmed officials), and this action independently re-checks that
 * the caller may see this tenant's official surfaces at all. The RLS policy is
 * the tighter of the two — it is what proves the row belongs to the caller —
 * so this layer fails fast with a readable message rather than duplicating it.
 *
 * Declaring does NOT withdraw any existing assignment. The admin grid warns on
 * the overlap and an admin decides; see the migration header for why this
 * warns rather than blocks.
 */
export async function declareUnavailability(
  input: DeclareUnavailabilityInput
): Promise<DeclareUnavailabilityResult> {
  const parsed = declareSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn('declareUnavailability: invalid input', { issues: parsed.error.issues })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  const { tenantSlug } = parsed.data

  const user = await getCurrentUser()
  if (!user) return { error: await tError('actionErrors.notAuthorized') }

  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  // A tenant_admin reaching this surface by role alone holds no roster row and
  // so has nothing to declare against — the same condition hasAccountScreen
  // uses for ACCT-01. Checked here rather than left to the RLS policy so the
  // message is readable instead of a bare constraint failure.
  const officialId = tenant.officialId
  if (!officialId) return { error: await tError('actionErrors.notAuthorized') }

  const { startsAt, endsAt } = toPeriodBounds(parsed.data)

  // The DB's CHECK enforces this too; catching it here turns a 23514 into a
  // message naming the actual problem.
  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    return { error: 'availability.errorEndBeforeStart' }
  }

  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('official_unavailability')
    .insert({
      tenant_id: tenant.id,
      official_id: officialId,
      starts_at: startsAt,
      ends_at: endsAt,
    })
    .select('id')
    .single()

  if (error) {
    logger.error('declareUnavailability: insert failed', error, {
      tenantId: tenant.id,
      officialId,
      startsAt,
      endsAt,
    })
    return { error: 'availability.saveFailed' }
  }

  // Official surfaces are ADR-0003 Group 2 (uncached), so revalidatePath is
  // what refreshes the list on the next navigation. The admin grid is NOT
  // revalidated from here: it is a different route segment under a different
  // layout, it re-reads on its own navigation, and an official has no business
  // invalidating an admin's render.
  revalidatePath(`/${tenantSlug}/availability`)

  return { id: data.id }
}

const withdrawSchema = z.object({
  tenantSlug: z.string().min(1),
  periodId: z.string().uuid(),
})

export type WithdrawUnavailabilityInput = z.input<typeof withdrawSchema>
export type WithdrawUnavailabilityResult = { error?: string; notOwned?: boolean }

/**
 * Withdraws a period the calling official previously declared.
 *
 * The delete is scoped by official_id as well as by id even though RLS already
 * restricts it to the caller's own rows — defense in depth, and it makes the
 * intent legible at the call site rather than only in the policy.
 */
export async function withdrawUnavailability(
  input: WithdrawUnavailabilityInput
): Promise<WithdrawUnavailabilityResult> {
  const parsed = withdrawSchema.safeParse(input)
  if (!parsed.success) {
    logger.warn('withdrawUnavailability: invalid input', { issues: parsed.error.issues })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  const { tenantSlug, periodId } = parsed.data

  const user = await getCurrentUser()
  if (!user) return { error: await tError('actionErrors.notAuthorized') }

  const tenant = await getOfficialTenant(tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const officialId = tenant.officialId
  if (!officialId) return { error: await tError('actionErrors.notAuthorized') }

  const supabase = await createSupabaseServerClient()

  // `count: 'exact'` is what makes the ownership rule observable. Without it a
  // refused delete and a successful one are indistinguishable from here: RLS
  // removes zero rows and PostgREST reports no error, so the UI would say
  // "removed" for a period that is still there and reappears on the next load.
  // The admin counterpart in ../../(tenant)/.../unavailability-actions.ts does
  // the same for the mirror case.
  const { error, count } = await supabase
    .from('official_unavailability')
    .delete({ count: 'exact' })
    .eq('id', periodId)
    .eq('official_id', officialId)
    .eq('tenant_id', tenant.id)
    // Belt and braces alongside the RLS policy, and it states at the call site
    // what the policy enforces: an official withdraws only their own
    // declarations, never time off the organisers recorded for them.
    .eq('created_by_role', 'official')

  if (error) {
    logger.error('withdrawUnavailability: delete failed', error, {
      tenantId: tenant.id,
      officialId,
      periodId,
    })
    return { error: 'availability.deleteFailed' }
  }

  if (count === 0) {
    return { notOwned: true, error: 'availability.notOwned' }
  }

  revalidatePath(`/${tenantSlug}/availability`)

  return {}
}
