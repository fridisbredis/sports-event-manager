import { ScrollShadow } from '@heroui/react'
import { CalendarOff } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { WORK_AREA_COLORS, workAreaColorMap } from '@/lib/theme/work-area-colors'
import type { WorkstationData } from './scheduling-types'
import type { PersonDragPicker as PersonDragPickerState } from './use-scheduling-grid-interaction'

interface PersonDragPickerProps {
  picker: NonNullable<PersonDragPickerState>
  /** Work areas open during every painted slot. May be empty. */
  openWorkstations: WorkstationData[]
  /** How many people already hold each work area at the painted slots. */
  countFor: (workstationId: string) => number
  onPickWorkstation: (workstationId: string) => void
  onPickTimeOff: () => void
}

/**
 * What to fill a painted run of one person's row with.
 *
 * Time off sits in the same menu as the work areas rather than behind its own
 * control, because at the moment of asking "what is this person doing from
 * 13:00 to 16:00?" the honest answers are a station or nothing — and making
 * the second one a different gesture entirely would hide it.
 *
 * It is visually separated rather than merely listed: its own section below a
 * divider, a slate swatch instead of a work-area colour, and an icon. The
 * work-area palette means "a place to stand", and letting time off borrow one
 * of those hues would read as just another station.
 */
export function PersonDragPicker({
  picker,
  openWorkstations,
  countFor,
  onPickWorkstation,
  onPickTimeOff,
}: PersonDragPickerProps) {
  const { t } = useTranslation('admin')

  const PICKER_WIDTH = 224 // px, matches w-56
  const opensLeft =
    typeof window !== 'undefined' && picker.anchorLeft + PICKER_WIDTH > window.innerWidth

  const colors = workAreaColorMap(openWorkstations.map((ws) => ({ id: ws.id, color: ws.color })))

  return (
    <div
      className="fixed z-50 w-56 rounded-md border border-gray-200 bg-white shadow-lg"
      style={{
        top: picker.anchorTop,
        left: picker.anchorLeft,
        transform: opensLeft
          ? 'translate(-100%, calc(-100% - 4px))'
          : 'translateY(calc(-100% - 4px))',
      }}
      data-person-drag-picker
    >
      <p className="truncate px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-gray-400">
        {t('scheduling.dragPaintPickArea', {
          name: picker.officialName,
          count: picker.cellStarts.length,
        })}
      </p>

      {openWorkstations.length > 0 && (
        <ScrollShadow className="flex max-h-56 flex-col overflow-y-auto">
          {openWorkstations.map((ws) => {
            const color = colors.get(ws.id) ?? WORK_AREA_COLORS[0]
            return (
              <Button
                key={ws.id}
                variant="light"
                size="sm"
                className="h-8 w-full shrink-0 justify-start rounded-none px-3 hover:bg-gray-50"
                onPress={() => onPickWorkstation(ws.id)}
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    {/* `bg`, not `fg`: the pair is a pastel background and a
                        muted foreground meant to be read ON it, so a swatch
                        painted in `fg` comes out dark and greyish. Filled
                        schedule cells use `bg` for the same reason, and the
                        swatch has to match the cell it will produce. The
                        border keeps the palest shades visible on white. */}
                    <span
                      className="size-3 shrink-0 rounded-sm border"
                      style={{ backgroundColor: color.bg, borderColor: color.fg }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{ws.name}</span>
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-gray-400">
                    {countFor(ws.id)}/{ws.capacity_ceiling}
                  </span>
                </span>
              </Button>
            )
          })}
        </ScrollShadow>
      )}

      {/* Below a divider, in slate rather than any work-area colour: this is
          the one option that is not a place to stand. */}
      <div className="border-t border-gray-100">
        <Button
          variant="light"
          size="sm"
          className="h-9 w-full shrink-0 justify-start rounded-none px-3 hover:bg-slate-50"
          onPress={onPickTimeOff}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CalendarOff className="size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            <span className="truncate text-slate-700">{t('scheduling.dragPaintTimeOff')}</span>
          </span>
        </Button>
      </div>
    </div>
  )
}
