import { DEFAULT_TENANT_PALETTE, TENANT_PALETTES, type TenantPaletteKey } from './tenant-colors'

function isTenantPaletteKey(value: string): value is TenantPaletteKey {
  return value in TENANT_PALETTES
}

// The variable/value pairs a palette resolves to. Shared so the client can
// repaint the theme on a preview without duplicating the token list — one
// place to add a token, not two that drift.
export function tenantThemeVars(colorPalette: string): [string, string][] {
  const key = isTenantPaletteKey(colorPalette) ? colorPalette : DEFAULT_TENANT_PALETTE
  const palette = TENANT_PALETTES[key]

  return [
    ['--heroui-primary', palette.primary],
    ['--heroui-primary-foreground', '0 0% 100%'],
    ['--heroui-secondary', palette.secondary],
    ['--heroui-secondary-foreground', '0 0% 100%'],
    ['--heroui-accent', palette.accent],
    ['--tenant-primary', palette.primary],
    ['--tenant-primary-hover', palette.primaryHover],
    ['--tenant-primary-tint', palette.primaryTint],
    ['--tenant-primary-tint-text', palette.primaryTintText],
    ['--tenant-secondary', palette.secondary],
    ['--tenant-accent-tint', palette.accentTint],
    ['--tenant-accent-tint-text', palette.accentTintText],
  ]
}

export function TenantThemeStyle({ colorPalette }: { colorPalette: string }) {
  // Two sets of variables are emitted:
  //
  // 1. `--heroui-*` — consumed by HeroUI's own generated CSS. Only the names
  //    HeroUI knows about belong here.
  // 2. `--tenant-*` — our own tokens (hover/tint pairs) for styling outside
  //    HeroUI components. Use these rather than re-deriving tints with
  //    color-mix: the handoff's tints are hand-tuned, not mechanical mixes.
  //
  // All palette primary/secondary colors sit at lightness <= 41%, so white
  // foreground text clears 4.5:1 on them. HeroUI otherwise computes foreground
  // from its own built-in blue/purple, not from our palette.
  const css = tenantThemeVars(colorPalette)
    .map(([name, value]) => `${name}:${value}`)
    .join(';')

  return <style>{`:root{${css};}`}</style>
}
