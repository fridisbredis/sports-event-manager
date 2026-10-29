import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getAdminTenant } from '@/lib/auth/tenant'
import TenantSettingsPage from './page'

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))
vi.mock('@/lib/auth/tenant', () => ({ getAdminTenant: vi.fn() }))
vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn(async () => 'en') }))
// A client component; the page test only cares what it is handed.
vi.mock('./_components/color-theme-form', () => ({ ColorThemeForm: () => null }))

const params = Promise.resolve({ tenantSlug: 'viadal' })

function tenant(tier: string) {
  return { id: 't1', slug: 'viadal', color_palette: 'purple', tier, is_active: true }
}

describe('TenantSettingsPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s for a caller who is not this tenant’s admin', async () => {
    vi.mocked(getAdminTenant).mockResolvedValue(null)
    await expect(TenantSettingsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  // The picker shows the palette the screens actually render with: the stored
  // one where the tier includes the theme, the default where it does not.
  it.each([
    ['premium', 'purple', true],
    ['standard', 'blue', false],
  ])('on %s hands the form the effective palette', async (tier, palette, canChoose) => {
    vi.mocked(getAdminTenant).mockResolvedValue(tenant(tier) as never)
    const tree = JSON.stringify(await TenantSettingsPage({ params }))
    expect(tree).toContain(`"initialColorPalette":"${palette}"`)
    expect(tree).toContain(`"canChooseColorTheme":${canChoose}`)
  })
})
