// Per-tenant color palettes for HeroUI theming.
// Each color is an "H S% L%" triplet (no `hsl()` wrapper) because HeroUI's
// generated CSS renders them as `hsl(var(--heroui-primary))` etc.

export type TenantColorKey = 'primary' | 'secondary' | 'accent'

export type TenantPalette = Record<TenantColorKey, string>

export const TENANT_PALETTES = {
    blue: {
        primary: '212 100% 47%',
        secondary: '291 64% 42%',
        accent: '199 89% 48%',
    },
    green: {
        primary: '142 71% 35%',
        secondary: '291 64% 42%',
        accent: '82 65% 45%',
    },
    orange: {
        primary: '24 95% 48%',
        secondary: '291 64% 42%',
        accent: '43 96% 50%',
    },
} as const satisfies Record<string, TenantPalette>

export type TenantPaletteKey = keyof typeof TENANT_PALETTES

export const DEFAULT_TENANT_PALETTE: TenantPaletteKey = 'blue'
