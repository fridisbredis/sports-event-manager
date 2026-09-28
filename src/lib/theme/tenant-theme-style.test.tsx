import { describe, it, expect } from 'vitest'
import { tenantThemeVars, TenantThemeStyle } from './tenant-theme-style'
import { TENANT_PALETTES, DEFAULT_TENANT_PALETTE } from './tenant-colors'

describe('tenantThemeVars', () => {
  it('resolves every palette the theme defines', () => {
    for (const key of Object.keys(TENANT_PALETTES)) {
      const vars = Object.fromEntries(tenantThemeVars(key))
      expect(vars['--tenant-primary']).toBe(
        TENANT_PALETTES[key as keyof typeof TENANT_PALETTES].primary
      )
    }
  })

  it('falls back to the default palette for an unknown key', () => {
    // A tenant row can hold a key a later build no longer defines — 'orange'
    // was dropped this way. That must degrade to the default, not throw.
    const vars = Object.fromEntries(tenantThemeVars('orange'))
    expect(vars['--tenant-primary']).toBe(TENANT_PALETTES[DEFAULT_TENANT_PALETTE].primary)
  })

  it('emits the same variables the server component renders', () => {
    // The picker paints these onto :root for an instant preview while the
    // server component emits them as a <style> tag. If the two drift, the
    // preview and the post-reload theme stop matching.
    const el = TenantThemeStyle({ colorPalette: 'purple' })
    const css = (el.props as { children: string }).children

    for (const [name, value] of tenantThemeVars('purple')) {
      expect(css).toContain(`${name}:${value}`)
    }
  })
})
