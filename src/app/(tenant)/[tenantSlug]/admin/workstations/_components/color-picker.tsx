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
              // Every swatch carries a ring, but the two sit differently: an
              // unselected one is a hairline standing clear of the circle,
              // while the selected one is a heavy band hugging it with no gap.
              // Both therefore end at the same outer radius (1px ring + 2px
              // offset == 3px ring + 0px), so selecting a colour fills the
              // ring in rather than growing the swatch.
              //
              // The branches are mutually exclusive rather than one layered
              // over a shared default, because the ring utilities are the same
              // specificity: which won would otherwise come down to their
              // order in the stylesheet.
              className={`relative size-[22px] rounded-full transition-[box-shadow,transform] hover:scale-110 focus:outline-none focus-visible:ring-ink ${
                isSelected ? 'ring-[3px] ring-offset-0 ring-ink' : 'ring-1 ring-offset-2 ring-edge'
              }`}
              style={{ backgroundColor: color.bg }}
            >
              {/* The "already used" mark. A diagonal bar rather than a border
                  or an opacity change: it survives being drawn over 30
                  different pastels, and it does not read as "disabled" —
                  these stay selectable on purpose. Drawn inside the circle
                  edge to edge (a chord through the centre is the diameter, so
                  100% lands exactly on the rim) and leaning up to the right,
                  with square ends, per the design. */}
              {isTaken && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className="h-[2.5px] w-full -rotate-45"
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
