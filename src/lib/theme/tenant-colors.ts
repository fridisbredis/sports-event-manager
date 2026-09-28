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
  green: {
    primary: '142.4 71.8% 29.2%', //  #15803D
    primaryHover: '146.4 73.7% 22.4%', // #0F6334
    primaryTint: '140.9 48.9% 90.8%', // #DCF3E4
    primaryTintText: '146.4 73.7% 22.4%', // #0F6334
    secondary: '175.3 77.4% 26.1%', // #0F766E
    accent: '85.2 78.1% 26.9%', //    #4D7A0F
    accentTint: '151.8 81% 95.9%', // #ECFDF5
    accentTintText: '85.2 78.1% 26.9%', // #4D7A0F
  },
  orange: {
    primary: '17.5 88.3% 40.4%', //   #C2410C
    primaryHover: '18 88.4% 33.9%', // #A3380A
    primaryTint: '34.3 100% 91.8%', // #FFEDD5
    primaryTintText: '22.7 82.5% 31.4%', // #92400E
    secondary: '26 90.5% 37.1%', //   #B45309
    accent: '22.7 82.5% 31.4%', //    #92400E
    accentTint: '34.3 100% 91.8%', // #FFEDD5
    accentTintText: '22.7 82.5% 31.4%', // #92400E
  },
} as const satisfies Record<string, TenantPalette>

export type TenantPaletteKey = keyof typeof TENANT_PALETTES

export const DEFAULT_TENANT_PALETTE: TenantPaletteKey = 'blue'
