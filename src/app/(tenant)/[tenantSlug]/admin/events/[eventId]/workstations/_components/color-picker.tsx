'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Tooltip } from '@heroui/react'
import { ChevronDown } from 'lucide-react'
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
  /** Replaces the hint, whose default talks about the schedule (N72 tasks). */
  hint?: string
}

export function ColorPicker({ value, takenBy, onChange, hint }: Props) {
  const { t } = useTranslation('admin')
  const paletteId = useId()

  const selectedIndex = WORK_AREA_COLORS.findIndex((c) => c.name === value)
  const selected = selectedIndex >= 0 ? WORK_AREA_COLORS[selectedIndex] : undefined

  // N70: the colour is chosen once, so the 30-swatch palette stays folded
  // behind the current choice and a "Change" button. With nothing chosen yet
  // there is nothing to fold behind, so it starts open — an extra "Choose
  // colour" click would only delay the one decision the admin came to make.
  // A name retired from the palette counts as nothing chosen: there is no
  // swatch to show for it.
  const [isOpen, setIsOpen] = useState(selected === undefined)

  const changeButtonRef = useRef<HTMLButtonElement>(null)
  const paletteRef = useRef<HTMLDivElement>(null)
  // Where focus should land once the open/closed render has committed. A
  // flag rather than focusing inline because the target does not exist (or
  // is still `hidden`) until after that render.
  const pendingFocus = useRef<'palette' | 'button' | null>(null)

  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (target === 'button') {
      changeButtonRef.current?.focus()
    } else if (target === 'palette') {
      // The selected swatch if there is one — that is where the admin's
      // attention already is — otherwise the first.
      const swatchButtons = paletteRef.current?.querySelectorAll<HTMLButtonElement>('button')
      const pressed = paletteRef.current?.querySelector<HTMLButtonElement>(
        'button[aria-pressed="true"]'
      )
      ;(pressed ?? swatchButtons?.[0])?.focus()
    }
  }, [isOpen])

  function open() {
    pendingFocus.current = 'palette'
    setIsOpen(true)
  }

  function choose(color: string) {
    onChange(color)
    pendingFocus.current = 'button'
    setIsOpen(false)
  }

  // Escape folds the palette back without changing anything — but only when
  // there is a choice to fold back to.
  function onPaletteKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape' && selected) {
      event.preventDefault()
      pendingFocus.current = 'button'
      setIsOpen(false)
    }
  }

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
      <p className="mb-4 text-[13px] text-gray-400">{hint ?? t('workstations.colorHint')}</p>

      {/* The folded state: the current choice as a bare swatch, no ring — the
          heavy "selected" ring only means something next to its siblings, and
          alone it read as a heavy outline. The palette's own names never
          render (see work-area-colors.ts), so the swatch is labelled by its
          position, as it is inside the palette. */}
      {selected && !isOpen && (
        <div className="flex items-center gap-4">
          <span
            role="img"
            aria-label={`${t('workstations.colorSelected')}: ${t('workstations.colorSwatchLabel', {
              index: selectedIndex + 1,
              total: WORK_AREA_COLORS.length,
            })}`}
            className="size-[22px] shrink-0 rounded-full"
            style={{ backgroundColor: selected.bg }}
          />
          <button
            ref={changeButtonRef}
            type="button"
            onClick={open}
            aria-expanded={isOpen}
            aria-controls={paletteId}
            // Same height as the swatch with `leading-none`, so the label is
            // centred on the swatch rather than on the font's line box — which
            // sat it a pixel or two off. Underline on the label only, so it
            // does not run under the caret.
            className="group inline-flex h-[22px] items-center gap-1 text-[13px] font-medium leading-none text-tenant-primary focus:outline-none"
          >
            <span className="underline-offset-4 group-hover:underline group-focus-visible:underline">
              {t('workstations.colorChange')}
            </span>
            <ChevronDown aria-hidden="true" className="size-3.5" strokeWidth={2.25} />
          </button>
        </div>
      )}

      {/* Ten per row at every width: the palette reads as three hue runs, and
          reflowing it into uneven rows would lose that structure.
          Fixed-size swatches in a `w-fit` grid rather than `w-full` in a
          10-column one — the latter grows each swatch with the card, which on
          a wide screen turned them into ~50px slabs. */}
      {/* Kept mounted while folded (just `hidden`) so the Change button's
          aria-controls always points at a real element. */}
      <div
        ref={paletteRef}
        id={paletteId}
        hidden={!isOpen}
        onKeyDown={onPaletteKeyDown}
        // `hidden` alone loses to the `grid` display utility (same
        // specificity, later in the stylesheet), so the class switches too.
        className={`${isOpen ? 'grid' : 'hidden'} w-fit grid-cols-10 gap-2.5`}
      >
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
              onClick={() => choose(color.name)}
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

      {isOpen && takenBy.length > 0 && (
        <p className="mt-3 text-[13px] text-gray-400">{t('workstations.colorTakenHint')}</p>
      )}
    </section>
  )
}
