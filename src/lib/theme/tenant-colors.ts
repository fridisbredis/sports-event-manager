// Per-tenant color palettes for HeroUI theming.
//
// Source of truth: docs/design_handoff_admin_dashboard/README.md ("Design Tokens").
// Every value below was tuned in lightness (hue preserved) so that text colors
// reach WCAG 2.2 AA 4.5:1 against white and UI borders reach 3:1.
//
// Each color is an "H S% L%" triplet (no `hsl()` wrapper) because HeroUI's
// generated CSS renders them as `hsl(var(--heroui-primary))` etc. The hex value
// each triplet was converted from is kept in a trailing comment so the palette
// can be diffed against the handoff without re-running a converter.

export type TenantColorKey =
  | 'primary'
  | 'primaryHover'
  | 'primaryTint'
  | 'primaryTintText'
  | 'secondary'
  | 'accent'
  | 'accentTint'
  | 'accentTintText'

export type TenantPalette = Record<TenantColorKey, string>

export const TENANT_PALETTES = {
  blue: {
    primary: '211.9 100% 41%', //     #0062D1
    primaryHover: '212 100% 34.5%', // #0052B0
    primaryTint: '214.3 84% 95.1%', // #E8F1FD
    primaryTintText: '212 100% 34.5%', // #0052B0
    secondary: '225.9 70.7% 40.2%', // #1E40AF
    accent: '201.1 100% 34.5%', //    #0072B0
    accentTint: '199.2 80.6% 93.9%', // #E3F4FC
    accentTintText: '201.1 100% 34.5%', // #0072B0
  },
  // Teal. Replaces an earlier green palette whose primary and accent sat
  // under AA against white (2.42:1 and 2.77:1); these are the values from
  // the handoff's corrected column — 5.36:1, 10.35:1 and 5.93:1. The key is
  // still named `green` because it is a stored tenant setting: renaming it
  // would need a data migration to match.
  green: {
    primary: '192.9 82.3% 31%', //    #0E7490
    primaryHover: '192.9 82.3% 24%', // #0B5A70
    primaryTint: '192.9 84% 95.1%', // #E8F8FD
    primaryTintText: '192.9 82.3% 24%', // #0B5A70
    secondary: '215.3 25% 26.7%', //  #334155
    accent: '201.3 96.3% 32.2%', //   #0369A1
    accentTint: '201.3 80.6% 94.5%', // #E6F4FC
    accentTintText: '201.3 96.3% 32.2%', // #0369A1
  },
  // Purple. Replaces the orange palette, which no tenant used in either
  // environment when it was dropped. All three of its roles were under AA
  // before this round (3.78:1, 4.23:1 and 2.64:1); these are the handoff's
  // corrected values — 5.70:1, 7.90:1 and 6.32:1.
  purple: {
    primary: '262.1 83.3% 57.8%', //  #7C3AED
    primaryHover: '262.1 83.3% 50.8%', // #6619EA
    primaryTint: '262.1 84% 95.1%', // #F0E8FD
    primaryTintText: '262.1 83.3% 50.8%', // #6619EA
    secondary: '244.5 57.9% 50.6%', // #4338CA
    accent: '294.7 72.4% 39.8%', //   #A21CAF
    accentTint: '294.7 80.6% 94.5%', // #FAE6FC
    accentTintText: '294.7 72.4% 39.8%', // #A21CAF
  },
} as const satisfies Record<string, TenantPalette>

export type TenantPaletteKey = keyof typeof TENANT_PALETTES

export const DEFAULT_TENANT_PALETTE: TenantPaletteKey = 'blue'
