'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { TENANT_PALETTES, type TenantPaletteKey } from '@/lib/theme/tenant-colors'
import { hasFeature } from '@/lib/tiers/features'
import { logger } from '@/lib/logger'
import { translateDbError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'

const tenantIdSchema = z.string().uuid()

// The colour theme belongs to the tenant, not to any one event (N23): it
// paints every screen under /{tenantSlug}, the official ones included. It
// used to sit on an event's configuration page, which with several events
// made a change in one event silently restyle all the others.
export interface UpdateColorPaletteResult {
  error?: string
}

export async function updateTenantColorPalette(
  tenantSlug: string,
  tenantId: string,
  colorPalette: TenantPaletteKey
): Promise<UpdateColorPaletteResult> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const parsedTenantId = tenantIdSchema.safeParse(tenantId)
  if (!parsedTenantId.success) {
    logger.warn('updateTenantColorPalette: invalid tenantId', { tenantId })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  if (!(await hasAdminAccessToTenant(user.id, parsedTenantId.data)))
    return { error: await tError('actionErrors.notAuthorized') }

  if (!(colorPalette in TENANT_PALETTES))
    return { error: await tError('actionErrors.unknownColorPalette') }

  // Choosing a theme is a tier feature (SYS-02). The read path already renders
  // the default palette below the unlocking tier, so this guard is the second
  // half of the same rule: without it a tenant under that tier could still
  // store a choice that never appears, and the stored value would spring to
  // life on some future upgrade nobody connected to this action.
  //
  // The tier is read here rather than taken from the caller: it governs
  // access, so it cannot come from the client.
  const { data: tierRow, error: tierError } = await supabase
    .from('tenants')
    .select('tier')
    .eq('id', parsedTenantId.data)
    .maybeSingle()

  if (tierError)
    return {
      error: await translateDbError('updateTenantColorPalette: tier lookup failed', tierError),
    }

  if (!tierRow || !hasFeature(tierRow.tier, 'colorTheme')) {
    logger.warn('updateTenantColorPalette: tier does not include the colour theme', {
      tenantId: parsedTenantId.data,
      tier: tierRow?.tier,
    })
    return { error: await tError('actionErrors.colorThemeNotInTier') }
  }

  // `select()` so the row count comes back: an UPDATE whose rows are all
  // filtered out by RLS is not an error in Postgres — it reports success
  // having changed nothing. Without this check a missing policy looks exactly
  // like a successful save, which is how the picker once appeared to store a
  // theme it never wrote.
  const { data, error } = await supabase
    .from('tenants')
    .update({ color_palette: colorPalette })
    .eq('id', parsedTenantId.data)
    .select('id')

  if (error)
    return { error: await translateDbError('updateTenantColorPalette: update failed', error) }

  if (!data || data.length === 0) {
    logger.error('updateTenantColorPalette: update matched no rows', {
      tenantId: parsedTenantId.data,
    })
    return { error: await tError('actionErrors.notAuthorized') }
  }

  revalidatePath(`/${tenantSlug}`, 'layout')

  return {}
}
