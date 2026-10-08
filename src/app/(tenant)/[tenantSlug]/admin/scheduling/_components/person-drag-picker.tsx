import { Modal, ModalContent, ModalHeader, ModalBody, ScrollShadow } from '@heroui/react'
import { CalendarOff } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/client'
import { WORK_AREA_COLORS, workAreaColorMap } from '@/lib/theme/work-area-colors'
import { useArmedAfterGesture } from './use-armed-after-gesture'
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
  onClose: () => void
}

/**
 * What to fill a painted run of one person's row with.
 *
 * Same modal frame as the slot picker rather than an anchored popup: both
 * answer "what goes in these painted cells?" at the end of the same gesture,
 * and a drag that ends near an edge had to flip the popup around to stay on
 * screen. A centred modal has no edge to fight, and the two surfaces now read
 * as one feature. The rows match it too — full-width targets, the count
 * sitting where the slot picker's status chip sits.
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
  onClose,
}: PersonDragPickerProps) {
  const { t } = useTranslation('admin')

  // This picker only ever opens from a drag's own `pointerup`.
  const armed = useArmedAfterGesture(true)
  const colors = workAreaColorMap(openWorkstations.map((ws) => ({ id: ws.id, color: ws.color })))

  return (
    <Modal
      isOpen
      size="2xl"
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      classNames={{ base: 'bg-gray-50' }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1 text-sm font-semibold">
              {t('scheduling.dragPaintPickAreaTitle', {
                name: picker.officialName,
                count: picker.cellStarts.length,
              })}
            </ModalHeader>
            <ModalBody>
              <div>
                <p className="section-label mb-2">{t('scheduling.dragPaintPickAreaLabel')}</p>
                {openWorkstations.length === 0 ? (
                  <p className="px-1 py-2 text-sm text-ink-label">
                    {t('scheduling.dragPaintNoOpenAreas')}
                  </p>
                ) : (
                  <ScrollShadow className="flex max-h-80 flex-col gap-0.5">
                    {openWorkstations.map((ws) => {
                      const color = colors.get(ws.id) ?? WORK_AREA_COLORS[0]
                      return (
                        <button
                          key={ws.id}
                          type="button"
                          onClick={() => {
                            if (armed) onPickWorkstation(ws.id)
                          }}
                          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-gray-100"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {/* `bg`, not `fg`: the pair is a pastel background
                                and a muted foreground meant to be read ON it,
                                so a swatch painted in `fg` comes out dark and
                                greyish. Filled schedule cells use `bg` for the
                                same reason, and the swatch has to match the
                                cell it will produce. No border, so the swatch
                                reads as the flat colour chip the cell will be. */}
                            <span
                              className="size-3 shrink-0 rounded-sm"
                              style={{ backgroundColor: color.bg }}
                              aria-hidden="true"
                            />
                            <span className="truncate text-sm text-gray-900">{ws.name}</span>
                          </span>
                          {/* Count and action together at the row's end, the
                              same shape as the slot picker: the occupancy
                              qualifies the Add beside it. */}
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-xs tabular-nums text-gray-400">
                              {countFor(ws.id)}/{ws.capacity_ceiling}
                            </span>
                            <span
                              aria-hidden="true"
                              className="rounded-md border border-gray-300 px-3 py-1 text-xs text-gray-700"
                            >
                              {t('scheduling.slotModalAdd')}
                            </span>
                          </span>
                        </button>
                      )
                    })}
                  </ScrollShadow>
                )}
              </div>

              {/* Below a divider, in slate rather than any work-area colour:
                  this is the one option that is not a place to stand. */}
              <div className="border-t border-gray-200 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    if (armed) onPickTimeOff()
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-slate-100"
                >
                  <CalendarOff className="size-4 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="truncate text-sm text-slate-700">
                    {t('scheduling.dragPaintTimeOff')}
                  </span>
                </button>
              </div>
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
