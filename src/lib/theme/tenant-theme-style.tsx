import { DEFAULT_TENANT_PALETTE, TENANT_PALETTES, type TenantPaletteKey } from './tenant-colors'

function isTenantPaletteKey(value: string): value is TenantPaletteKey {
    return value in TENANT_PALETTES
}

export function TenantThemeStyle({ colorPalette }: { colorPalette: string }) {
    const key = isTenantPaletteKey(colorPalette) ? colorPalette : DEFAULT_TENANT_PALETTE
    const palette = TENANT_PALETTES[key]

    return (
        <style>{`:root{--heroui-primary:${palette.primary};--heroui-secondary:${palette.secondary};--heroui-accent:${palette.accent};}`}</style>
    )
}
