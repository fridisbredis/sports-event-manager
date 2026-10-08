import { Users } from 'lucide-react'
import { useMemo } from 'react'
import { Skeleton } from '@heroui/react'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { isWithinWindow, formatSlotLabel, initials } from '@/lib/scheduling/grid-logic'
import { AvatarImage } from '@/components/ui/avatar-image'
import { useTranslation } from '@/lib/i18n/client'
import {
  WORK_AREA_COLORS,
  workAreaBorderColor,
  workAreaColorMap,
} from '@/lib/theme/work-area-colors'
import {
  STRIPED_TIME_OFF_STYLE,
  STRIPED_TIME_OFF_ADMIN_STYLE,
  STRIPED_UNAVAILABLE_STYLE,
} from './grid-helpers'
import { dominantAuthor, type UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import type { PersonDrag } from './use-scheduling-grid-interaction'
import type { WorkstationData, OfficialData, LocalAssignment } from './scheduling-types'

interface ByPersonGridProps {
  slots: Date[]
  granularityMin: number
  officials: OfficialData[]
  stageWorkstations: WorkstationData[]
  activeAssignments: LocalAssignment[]
  doubleBookedOfficials: Set<string>
  /** `officialId:slotStartISO` keys covered by any kind of time off. */
  unavailableSlots: Set<string>
  /** The periods behind each of those keys, for hatch colour and tooltip. */
  periodsByCell: Map<string, UnavailabilityPeriod[]>
  /** In-progress paint along one person's row, or null. */
  personDrag: PersonDrag
  onPersonDragStart: (officialId: string, officialName: string, idx: number) => void
  onPersonDragEnter: (officialId: string, idx: number) => void
  /** Opens the popup listing what covers a hatched cell. */
  onTimeOffClick: (
    officialName: string,
    periods: UnavailabilityPeriod[],
    anchor: HTMLElement
  ) => void
  onCellClick: (officialId: string, slot: Date, ws?: WorkstationData, anchor?: HTMLElement) => void
  pendingCells: Set<string>
}

export function ByPersonGrid({
  slots,
  granularityMin,
  officials,
  stageWorkstations,
  activeAssignments,
  doubleBookedOfficials,
  unavailableSlots,
  periodsByCell,
  personDrag,
  onPersonDragStart,
  onPersonDragEnter,
  onTimeOffClick,
  onCellClick,
  pendingCells,
}: ByPersonGridProps) {
  const { t } = useTranslation('admin')

  const assignmentMap = useMemo(() => {
    const map = new Map<string, LocalAssignment>()
    for (const a of activeAssignments) {
      map.set(`${a.official_id}:${a.timeslot_start}`, a)
    }
    return map
  }, [activeAssignments])

  // Two independent colour spaces: one for the person avatars down the left,
  // one for the work-area cells. They are kept separate so an official can
  // never displace a work area's colour or vice versa. The avatar map is
  // keyed off `officials` so it matches the officials roster, which colours
  // the same people from the same list.
  const personColors = useMemo(() => workAreaColorMap(officials.map((o) => o.id)), [officials])
  const wsColors = useMemo(
    () => workAreaColorMap(stageWorkstations.map((ws) => ({ id: ws.id, color: ws.color }))),
    [stageWorkstations]
  )

  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of activeAssignments) {
      const key = `${a.workstation_id}:${a.timeslot_start}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [activeAssignments])

  const slotStartSet = useMemo(() => new Set(slots.map((s) => s.toISOString())), [slots])
  const hasAssignmentsToday = activeAssignments.some((a) => slotStartSet.has(a.timeslot_start))

  // Slots where at least one workstation is within its operating window
  const activeSlotSet = useMemo(() => {
    const set = new Set<string>()
    for (const slot of slots) {
      if (
        stageWorkstations.some((ws) =>
          isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
        )
      ) {
        set.add(slot.toISOString())
      }
    }
    return set
  }, [slots, granularityMin, stageWorkstations])

  if (officials.length === 0) {
    return (
      <EmptyStateCard
        Icon={Users}
        title={t('scheduling.noConfirmedOfficialsTitle')}
        description={t('scheduling.noConfirmedOfficialsHint')}
      />
    )
  }

  return (
    <div
      className={`scheduling-scroll-container ${CARD_SURFACE} overflow-x-auto overflow-y-auto max-h-[70vh] relative`}
    >
      <table className="w-full border-collapse text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-white text-left px-4 py-3 text-xs font-semibold uppercase tracking-label text-ink-faint w-40 border-b border-r border-edge-soft">
              {t('scheduling.colOfficial')}
            </th>
            {slots.map((slot) => (
              <th
                key={slot.toISOString()}
                className="sticky top-0 z-20 w-20 border-b border-edge-soft bg-white px-1 py-3 text-center text-[13px] font-semibold text-ink"
              >
                {formatSlotLabel(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {officials.map((official) => {
            const personColor = personColors.get(official.id) ?? WORK_AREA_COLORS[0]
            return (
              <tr key={official.id} className="border-b border-edge-soft last:border-0">
                <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-edge-soft">
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Same per-person colour the officials roster uses, so a
                      face is recognisable across screens. */}
                    <AvatarImage
                      src={official.avatar_url}
                      initials={initials(official.name)}
                      alt={official.name}
                      className="h-7 w-7 text-xs font-semibold"
                      style={{
                        backgroundColor: personColor.bg,
                        color: personColor.fg,
                      }}
                    />
                    <span className="truncate text-sm text-ink" title={official.name}>
                      {official.name}
                    </span>
                  </div>
                </td>
                {slots.map((slot, slotArrIdx) => {
                  const slotStart = slot.toISOString()
                  const assignment = assignmentMap.get(`${official.id}:${slotStart}`)
                  const ws = assignment
                    ? stageWorkstations.find((w) => w.id === assignment.workstation_id)
                    : undefined
                  const isDoubleBooked = doubleBookedOfficials.has(`${official.id}:${slotStart}`)
                  const cellKey = `${official.id}:${slotStart}`
                  const isUnavailable = unavailableSlots.has(cellKey)
                  // Which hatch to draw. Both kinds block equally; this only
                  // says whose note it is, so an admin can tell their own
                  // entry from the official's at a glance.
                  const timeOffAuthor = isUnavailable
                    ? dominantAuthor(periodsByCell.get(cellKey) ?? [])
                    : null
                  const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0

                  // Double-booking is a warning and keeps its orange styling —
                  // the work-area palette is decorative and must not mask it.
                  const color = ws ? (wsColors.get(ws.id) ?? WORK_AREA_COLORS[0]) : undefined
                  // Double-booking outranks an absence. Both are now hard —
                  // the save action refuses either — but a cell that is
                  // already assigned twice is the one an admin has to act on,
                  // and two warning styles on one cell read as neither.
                  const cellStyle = assignment
                    ? isDoubleBooked
                      ? 'bg-orange-50 border border-orange-200'
                      : isUnavailable
                        ? 'border ring-2 ring-inset ring-orange-300'
                        : 'border'
                    : ''
                  const cellColors =
                    assignment && !isDoubleBooked && color
                      ? {
                          backgroundColor: color.bg,
                          borderColor: workAreaBorderColor(color),
                          color: color.fg,
                        }
                      : undefined

                  const isPending = pendingCells.has(`p:${official.id}:${slotStart}`)

                  // Painted range, drawn live while the pointer is down.
                  // Normalised because a drag can run right-to-left.
                  const inPaint =
                    personDrag !== null &&
                    personDrag.officialId === official.id &&
                    slotArrIdx >= Math.min(personDrag.startIdx, personDrag.currentIdx) &&
                    slotArrIdx <= Math.max(personDrag.startIdx, personDrag.currentIdx)

                  return (
                    <td key={slotStart} className="relative px-1 py-2 align-top">
                      {isPending ? (
                        <Skeleton className="h-10 w-full rounded-md" />
                      ) : assignment ? (
                        <button
                          onClick={(e) =>
                            onCellClick(official.id, slot, undefined, e.currentTarget)
                          }
                          // `h-10` alone is a MINIMUM on a flex column: two text lines plus
                          // `gap-1` measure taller than 40px, so this button grew
                          // while the empty and hatched cells stayed exactly 40px —
                          // and with the row centring each cell independently, no two
                          // kinds of cell lined up. `overflow-hidden` holds the
                          // content to the box; the labels already truncate.
                          className={`flex h-10 max-h-10 w-full flex-col items-center justify-center gap-1 overflow-hidden rounded-md px-1 font-medium transition-colors hover:brightness-95 ${cellStyle} ${cellColors ? '' : 'text-gray-700'}`}
                          style={cellColors}
                        >
                          <span className="w-full truncate text-center text-[11px] leading-none">
                            {ws?.name ?? '—'}
                          </span>
                          <span
                            className={`shrink-0 text-[10px] leading-none tabular-nums ${isDoubleBooked ? 'text-orange-400' : cellColors ? 'opacity-70' : 'text-gray-400'}`}
                          >
                            {ws ? `${wsCount}/${ws.capacity_ceiling}` : ''}
                            {isDoubleBooked && ' ⊗'}
                          </span>
                        </button>
                      ) : activeSlotSet.has(slotStart) ? (
                        // Time off is a hard block (Peter, 2026-10-07): the
                        // cell stops being a button entirely rather than
                        // opening a picker that would then be refused by the
                        // server. The two hatches distinguish who recorded it.
                        isUnavailable ? (
                          // Clickable, but never to assign: the popup says
                          // what covers the cell and offers removal only for
                          // periods this admin recorded. Keeping it a button
                          // is what makes the block explainable rather than
                          // just inert.
                          <button
                            onClick={(e) =>
                              onTimeOffClick(
                                official.name,
                                periodsByCell.get(cellKey) ?? [],
                                e.currentTarget
                              )
                            }
                            // No border, transparent or otherwise. A
                            // transparent border still paints the background
                            // under itself, so the hatch would bleed 2px past
                            // the visible edge of the cells either side and
                            // read as a larger, mis-seated box. The bordered
                            // cells draw their border INSIDE h-10 (border-box),
                            // so a plain h-10 here matches them exactly.
                            className="h-10 w-full rounded-md transition-opacity hover:opacity-75"
                            style={
                              timeOffAuthor === 'tenant_admin'
                                ? STRIPED_TIME_OFF_ADMIN_STYLE
                                : STRIPED_TIME_OFF_STYLE
                            }
                            title={t('scheduling.timeOffBlockedCell')}
                          />
                        ) : (
                          <button
                            // No onClick: a plain click is just a one-slot
                            // drag, and the release handler opens the same
                            // picker. Two code paths to the same menu is what
                            // produced two different menus.
                            // Drag-to-paint across this person's row. Pointer
                            // events rather than mouse, so a stylus and a
                            // trackpad behave the same; the row is only ever
                            // painted on a desktop, since SCHED-01 is
                            // edit-on-desktop and view-only on mobile.
                            onPointerDown={() =>
                              onPersonDragStart(official.id, official.name, slotArrIdx)
                            }
                            onPointerEnter={() => onPersonDragEnter(official.id, slotArrIdx)}
                            className={`h-10 w-full rounded-md border transition-colors ${
                              inPaint
                                ? 'border-tenant-primary bg-tenant-primary-tint'
                                : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                            }`}
                          />
                        )
                      ) : (
                        <div
                          // Same reasoning as the time-off cell above: no
                          // border, so the hatch stops at the same edge the
                          // other cells' borders sit on.
                          className="h-10 w-full rounded-md"
                          style={STRIPED_UNAVAILABLE_STYLE}
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>

      {!hasAssignmentsToday && (
        <div className="px-4 py-3 border-t border-gray-50 text-center text-xs text-gray-400">
          {t('scheduling.noAssignmentsToday')}
        </div>
      )}
    </div>
  )
}
