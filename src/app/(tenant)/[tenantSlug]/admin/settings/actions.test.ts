import { describe, it, expect, vi, beforeEach } from 'vitest'
import { updateTenantColorPalette } from './actions'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasAdminAccessToTenant } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { logger } from '@/lib/logger'
import type { TenantPaletteKey } from '@/lib/theme/tenant-colors'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasAdminAccessToTenant: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// The real logger writes JSON to stderr and reports errors to Sentry, neither
// of which belongs in a unit test run.
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function chain(result: unknown) {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'update']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

// F-REL-22: never forward a raw DB error.message to the client — assert
// the translated fallback string, not the raw message the mock returns.
const GENERIC_SAVE_ERROR = 'Something went wrong while saving. Please try again.'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('updateTenantColorPalette', () => {
  // Resolved by the real i18n layer.
  const NOT_AUTHORIZED = 'Not authorized'

  // The action makes TWO `from('tenants')` calls: first the tier lookup that
  // gates the feature, then the update itself. They are handed out in order so
  // a test can fail either one independently.
  function paletteClient(
    updateBuilder?: ReturnType<typeof chain>,
    user: unknown = { id: 'user-1' },
    tierBuilder: ReturnType<typeof chain> = chain({
      data: { tier: 'professional' },
      error: null,
    })
  ) {
    let call = 0
    const fromMock = vi.fn(() => (call++ === 0 ? tierBuilder : updateBuilder))
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
      from: fromMock,
      rpc: vi.fn(),
    } as never)
    return fromMock
  }

  it('redirects to /login when there is no authenticated user', async () => {
    const fromMock = paletteClient(undefined, null)

    await expect(updateTenantColorPalette('viadal', TENANT_ID, 'blue')).rejects.toThrow(
      'NEXT_REDIRECT'
    )
    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('rejects a tenantId that is not a uuid without checking access or writing', async () => {
    const fromMock = paletteClient()

    const result = await updateTenantColorPalette('viadal', 'not-a-uuid', 'blue')

    expect(result).toEqual({ error: NOT_AUTHORIZED })
    expect(hasAdminAccessToTenant).not.toHaveBeenCalled()
    expect(fromMock).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith('updateTenantColorPalette: invalid tenantId', {
      tenantId: 'not-a-uuid',
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns an authorization error and never touches tenants when access is denied', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(false)
    const fromMock = paletteClient()

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'blue')

    expect(result).toEqual({ error: NOT_AUTHORIZED })
    expect(hasAdminAccessToTenant).toHaveBeenCalledWith('user-1', TENANT_ID)
    expect(fromMock).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a palette key that is not in TENANT_PALETTES', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const fromMock = paletteClient()

    const result = await updateTenantColorPalette(
      'viadal',
      TENANT_ID,
      'chartreuse' as TenantPaletteKey
    )

    expect(result).toEqual({ error: 'Unknown color palette' })
    expect(fromMock).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  // The colour theme is a tier feature (SYS-02). The read path already paints
  // the default palette below the unlocking tier; this guard is the write half
  // of the same rule, so a locked tenant cannot store a choice that would
  // spring to life on a later upgrade.
  it('refuses to write a palette when the tier does not include the theme', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const updateBuilder = chain({ data: [{ id: TENANT_ID }], error: null })
    const fromMock = paletteClient(
      updateBuilder,
      { id: 'user-1' },
      chain({ data: { tier: 'standard' }, error: null })
    )

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'purple')

    expect(result).toEqual({
      error: "The colour theme is not included in this tenant's feature tier.",
    })
    // The tier lookup happened; the update did not.
    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(updateBuilder.update).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('writes the palette when the tier includes the theme', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const updateBuilder = chain({ data: [{ id: TENANT_ID }], error: null })
    paletteClient(
      updateBuilder,
      { id: 'user-1' },
      chain({ data: { tier: 'premium' }, error: null })
    )

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'purple')

    expect(result.error).toBeUndefined()
    expect(updateBuilder.update).toHaveBeenCalledWith({ color_palette: 'purple' })
  })

  // A tenant row that vanished between the access check and the lookup must
  // fail closed rather than be treated as unlocked.
  it('refuses the write when the tenant row cannot be read', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const updateBuilder = chain({ data: [{ id: TENANT_ID }], error: null })
    paletteClient(updateBuilder, { id: 'user-1' }, chain({ data: null, error: null }))

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'purple')

    expect(result).toEqual({
      error: "The colour theme is not included in this tenant's feature tier.",
    })
    expect(updateBuilder.update).not.toHaveBeenCalled()
  })

  it('translates the db error from the tenants update and skips revalidation', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const updateBuilder = chain({ data: null, error: { message: 'connection reset' } })
    paletteClient(updateBuilder)

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'blue')

    // F-REL-22: the raw DB message must never reach the client.
    expect(result).toEqual({ error: GENERIC_SAVE_ERROR })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('treats an update that matched no rows as an authorization failure', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const updateBuilder = chain({ data: [], error: null })
    paletteClient(updateBuilder)

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'blue')

    // An UPDATE filtered out entirely by RLS succeeds while changing nothing —
    // the `select('id')` row count is what tells the two cases apart.
    expect(result).toEqual({ error: NOT_AUTHORIZED })
    expect(logger.error).toHaveBeenCalledWith('updateTenantColorPalette: update matched no rows', {
      tenantId: TENANT_ID,
    })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('writes the palette and revalidates the tenant subtree as a layout on success', async () => {
    vi.mocked(hasAdminAccessToTenant).mockResolvedValue(true)
    const updateBuilder = chain({ data: [{ id: TENANT_ID }], error: null })
    const fromMock = paletteClient(updateBuilder)

    const result = await updateTenantColorPalette('viadal', TENANT_ID, 'green')

    expect(result).toEqual({})
    expect(fromMock).toHaveBeenCalledWith('tenants')
    expect(updateBuilder.update).toHaveBeenCalledWith({ color_palette: 'green' })
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', TENANT_ID)
    expect(updateBuilder.select).toHaveBeenCalledWith('id')
    // 'layout' so every page under /{tenantSlug} picks up the new theme, not
    // just the admin page the picker lives on.
    expect(revalidatePath).toHaveBeenCalledWith('/viadal', 'layout')
  })
})
