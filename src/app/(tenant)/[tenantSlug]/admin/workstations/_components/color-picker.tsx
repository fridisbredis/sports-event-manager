'use client'

import { Tooltip } from '@heroui/react'
import { useTranslation } from '@/lib/i18n/client'
import { WORK_AREA_COLORS } from '@/lib/theme/work-area-colors'

/** A work area already holding a colour, for the "taken" marker. */
export interface ColorTakenBy {
  /** Palette name it holds. */
  color: string
  /** Shown in the tooltip so the admin knows which area to look at. */
  name: string
}

interface Props {
  /** Currently selected palette name, or null if none has been chosen. */
  value: string | null
  /**
   * Other work areas on the SAME stage and the colours they hold. Scoped to
   * the stage because that is what shares a schedule — two areas on different
   * stages never appear in one grid, so marking those would exhaust the
   * palette for no benefit.
   */
  takenBy: ColorTakenBy[]
  onChange: (color: string) => void
}

export function ColorPicker({ value, takenBy, onChange }: Props) {
  const { t } = useTranslation('admin')

  // Several areas can hold one colour, so this collects names rather than
  // overwriting — the tooltip names all of them.
  const takenNames = new Map<string, string[]>()
  for (const entry of takenBy) {
    const names = takenNames.get(entry.color)
    if (names) names.push(entry.name)
    else takenNames.set(entry.color, [entry.name])
  }

  return (
    <section>
      <h2 className="section-label mb-1">{t('workstations.colorLabel')}</h2>
      <p className="mb-4 text-[13px] text-ink-soft">{t('workstations.colorHint')}</p>

      {/* Ten per row at every width: the palette reads as three hue runs, and
          reflowing it into uneven rows would lose that structure.
          Fixed-size swatches in a `w-fit` grid rather than `w-full` in a
          10-column one — the latter grows each swatch with the card, which on
          a wide screen turned them into ~50px slabs. */}
      <div className="grid w-fit grid-cols-10 gap-2.5">
        {WORK_AREA_COLORS.map((color, index) => {
          const isSelected = value === color.name
          // A colour the selected area itself holds is not "taken" from its
          // own point of view — striking it through would tell the admin
          // their current choice is unavailable.
          const holders = isSelected ? undefined : takenNames.get(color.name)
          const isTaken = !!holders?.length

          const swatch = (
            <button
              type="button"
              onClick={() => onChange(color.name)}
              aria-pressed={isSelected}
              aria-label={
                isTaken
                  ? t('workstations.colorTakenBy', { name: holders.join(', ') })
                  : t('workstations.colorSwatchLabel', {
                      index: index + 1,
                      total: WORK_AREA_COLORS.length,
                    })
              }
              // The selected/unselected ring classes are mutually exclusive
              // rather than a `ring-2` added on top of a `ring-0` default:
              // both are the same specificity, so which one won would come
              // down to their order in the stylesheet. The explicit `ring-0`
              // is load-bearing — HeroUI's theme ships ring utilities into
              // this build, and without a reset every swatch picked up a
              // faint grey ring, not just the selected one.
              className={`relative size-[22px] rounded-full transition-[box-shadow,transform] hover:scale-110 focus:outline-none focus-visible:ring-offset-2 focus-visible:ring-ink ${
                isSelected ? 'ring-2 ring-offset-2 ring-ink' : 'ring-0 focus-visible:ring-2'
              }`}
              style={{ backgroundColor: color.bg }}
            >
              {/* The "already used" mark. A diagonal bar rather than a border
                  or an opacity change: it survives being drawn over 30
                  different pastels, and it does not read as "disabled" —
                  these stay selectable on purpose. Drawn inside the circle
                  (not overhanging it) and leaning up to the right, per the
                  design. */}
              {isTaken && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className="h-[2.5px] w-[85%] -rotate-45 rounded-full"
                    style={{ backgroundColor: color.fg }}
                  />
                </span>
              )}
            </button>
          )

          // Only the marked ones get a tooltip — there is nothing useful to
          // say about a free colour, and 30 hoverable tooltips would be noise.
          return isTaken ? (
            <Tooltip
              key={color.name}
              content={t('workstations.colorTakenBy', { name: holders.join(', ') })}
              delay={200}
              closeDelay={0}
            >
              {swatch}
            </Tooltip>
          ) : (
            <span key={color.name} className="contents">
              {swatch}
            </span>
          )
        })}
      </div>

      {takenBy.length > 0 && (
        <p className="mt-3 text-[13px] text-ink-soft">{t('workstations.colorTakenHint')}</p>
      )}
    </section>
  )
}
