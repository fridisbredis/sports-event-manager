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
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSelect(key)}
              disabled={isSavingPalette}
              aria-pressed={isSelected}
              aria-label={t(`eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
              className={`group flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 transition-colors ${
                isSelected ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'
              } ${isSavingPalette ? 'opacity-60' : ''}`}
            >
              <div className="flex -space-x-1.5">
                <span
                  className="h-5 w-5 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: `hsl(${palette.primary})` }}
                />
                <span
                  className="h-5 w-5 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: `hsl(${palette.secondary})` }}
                />
                <span
                  className="h-5 w-5 rounded-full ring-2 ring-white"
                  style={{ backgroundColor: `hsl(${palette.accent})` }}
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
