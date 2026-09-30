import { useTranslation } from '@/lib/i18n/client'
import { TENANT_PALETTES, type TenantPaletteKey } from '@/lib/theme/tenant-colors'

interface Props {
  colorPalette: string
  isSavingPalette: boolean
  paletteError: string | undefined
  onSelect: (key: TenantPaletteKey) => void
}

export function ColorPalettePicker({
  colorPalette,
  isSavingPalette,
  paletteError,
  onSelect,
}: Props) {
  const { t } = useTranslation('admin')

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
              disabled={isSavingPalette}
              aria-pressed={isSelected}
              aria-label={t(`eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              className={`group flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-2.5 transition-colors ${
                isSelected ? '' : 'border-gray-200 hover:border-gray-300'
              } ${isSavingPalette ? 'opacity-60' : ''}`}
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
              <span className="text-xs text-gray-500 group-hover:text-gray-700">
                {t(`eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              </span>
            </button>
          )
        })}
      </div>
      {paletteError && <p className="mt-1.5 text-xs text-red-500">{paletteError}</p>}
    </div>
  )
}
