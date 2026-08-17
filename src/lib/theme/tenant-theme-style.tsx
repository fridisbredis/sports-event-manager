import { DEFAULT_TENANT_PALETTE, TENANT_PALETTES, type TenantPaletteKey } from './tenant-colors'

function isTenantPaletteKey(value: string): value is TenantPaletteKey {
  return value in TENANT_PALETTES
}

export function TenantThemeStyle({ colorPalette }: { colorPalette: string }) {
  const key = isTenantPaletteKey(colorPalette) ? colorPalette : DEFAULT_TENANT_PALETTE
  const palette = TENANT_PALETTES[key]

  // All tenant palette colors are dark enough (lightness <= 55%) that white
  // foreground text always has sufficient contrast. HeroUI otherwise computes
  // foreground from its own built-in blue/purple, not from our palette.
  return (
    <style>{`:root{--heroui-primary:${palette.primary};--heroui-primary-foreground:0 0% 100%;--heroui-secondary:${palette.secondary};--heroui-secondary-foreground:0 0% 100%;--heroui-accent:${palette.accent};}`}</style>
  )
}
