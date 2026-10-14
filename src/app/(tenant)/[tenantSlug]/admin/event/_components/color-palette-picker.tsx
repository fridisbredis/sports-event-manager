import { useTranslation } from '@/lib/i18n/client'
import { TENANT_PALETTES, type TenantPaletteKey } from '@/lib/theme/tenant-colors'
import { TIER_FEATURES } from '@/lib/tiers/features'

interface Props {
  colorPalette: string
  isSavingPalette: boolean
  paletteError: string | undefined
  onSelect: (key: TenantPaletteKey) => void
  // Tenant's tier does not include the colour theme (SYS-02). The swatches
  // still render — showing what the feature offers is the point of the upsell
  // — but none of them can be chosen.
  isLocked?: boolean
}

export function ColorPalettePicker({
  colorPalette,
  isSavingPalette,
  paletteError,
  onSelect,
  isLocked = false,
}: Props) {
  const { t } = useTranslation('admin')
  const isDisabled = isSavingPalette || isLocked

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {t('eventConfig.colorTheme')}
      </label>
      <div className="flex items-center gap-3">
        {(Object.keys(TENANT_PALETTES) as TenantPaletteKey[]).map((key) => {
          const palette = TENANT_PALETTES[key]
          const isSelected = colorPalette === key
          const ringStyle = {
            '--tw-ring-color': isSelected ? `hsl(${palette.primaryTint})` : '#fff',
          } as React.CSSProperties
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              disabled={isDisabled}
              aria-pressed={isSelected}
              aria-label={t(`eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              className={`group flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-2.5 transition-colors ${
                isSelected ? '' : `border-gray-200 ${isLocked ? '' : 'hover:border-gray-300'}`
              } ${isDisabled ? 'opacity-60' : ''} ${isLocked ? 'cursor-not-allowed' : ''}`}
              // The selected swatch is outlined and filled in its OWN palette,
              // so the option previews the theme rather than reading as a
              // neutral "selected" box. primaryTint is the palette's own
              // surface shade, and the three tints are already balanced for
              // equal perceived lightness. Inline because the values come from
              // the palette map, not fixed Tailwind colours.
              style={
                isSelected
                  ? {
                      borderColor: `hsl(${palette.primary})`,
                      backgroundColor: `hsl(${palette.primaryTint})`,
                    }
                  : undefined
              }
            >
              <div className="flex -space-x-1.5">
                {/* The ring separates the overlapping dots, so it has to match
                    whatever surface sits behind them — white normally, the
                    palette tint once this option is selected. */}
                <span
                  className="h-5 w-5 rounded-full ring-2"
                  style={{ backgroundColor: `hsl(${palette.primary})`, ...ringStyle }}
                />
                <span
                  className="h-5 w-5 rounded-full ring-2"
                  style={{ backgroundColor: `hsl(${palette.secondary})`, ...ringStyle }}
                />
                <span
                  className="h-5 w-5 rounded-full ring-2"
                  style={{ backgroundColor: `hsl(${palette.accent})`, ...ringStyle }}
                />
              </div>
              <span
                className={`text-xs text-gray-500 ${isLocked ? '' : 'group-hover:text-gray-700'}`}
              >
                {t(`eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              </span>
            </button>
          )
        })}
      </div>
      {isLocked && (
        <p className="mt-1.5 text-xs text-gray-500">
          {t('eventConfig.colorThemeLocked', {
            tier: t(`systemAdmin.${TIER_FEATURES.colorTheme}`),
          })}
        </p>
      )}
      {paletteError && <p className="mt-1.5 text-xs text-red-500">{paletteError}</p>}
    </div>
  )
}
