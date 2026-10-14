import { describe, it, expect } from 'vitest'
import { effectivePalette, tenantThemeVars, TenantThemeStyle } from './tenant-theme-style'
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

describe('effectivePalette', () => {
  // The theme is a tier feature (SYS-02). Below the unlocking tier the stored
  // choice is ignored on READ — never rewritten — so it returns intact on an
  // upgrade without a data migration.
  it('ignores the stored palette below the unlocking tier', () => {
    expect(effectivePalette({ tier: 'standard', color_palette: 'purple' })).toBe(
      DEFAULT_TENANT_PALETTE
    )
  })

  it('honours the stored palette at the unlocking tier', () => {
    expect(effectivePalette({ tier: 'premium', color_palette: 'purple' })).toBe('purple')
  })

  it('honours the stored palette above the unlocking tier', () => {
    expect(effectivePalette({ tier: 'professional', color_palette: 'green' })).toBe('green')
  })

  it('falls back to the default when an unlocked tenant stored nothing', () => {
    expect(effectivePalette({ tier: 'professional', color_palette: null })).toBe(
      DEFAULT_TENANT_PALETTE
    )
  })

  // An unrecognised tier must not be read as the lowest tier and must not
  // throw — a hand-edited row should degrade to the default theme.
  it('falls back to the default for an unrecognised tier', () => {
    expect(effectivePalette({ tier: 'enterprise', color_palette: 'purple' })).toBe(
      DEFAULT_TENANT_PALETTE
    )
  })

  // What the user actually sees is the emitted variables, not the key.
  it('paints the default palette variables for a locked tenant', () => {
    const vars = Object.fromEntries(
      tenantThemeVars(effectivePalette({ tier: 'standard', color_palette: 'purple' }))
    )
    expect(vars['--tenant-primary']).toBe(TENANT_PALETTES[DEFAULT_TENANT_PALETTE].primary)
    expect(vars['--tenant-primary']).not.toBe(TENANT_PALETTES.purple.primary)
  })
})
