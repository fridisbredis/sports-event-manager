import { CalendarOff, Users } from 'lucide-react'
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
  STRIPED_UNAVAILABLE_STYLE,
  TIME_OFF_FILL,
  TIME_OFF_ICON,
  runEdgeClasses,
} from './grid-helpers'
import { dominantAuthor, type UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import type { PersonDrag } from './use-scheduling-grid-interaction'
import type { WorkstationData, OfficialData, LocalAssignment } from './scheduling-types'
import { STICKY_COL_SHADOW, STICKY_COL_SHADOW_HIDDEN } from './scheduling-types'
import { useHorizontalScrollShadow } from './use-horizontal-scroll-shadow'

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
  /**
   * The run a finished drag is still choosing a work area for, as
   * `officialId` plus its slot-start keys. The live `personDrag` clears on
   * pointer-up, which is exactly when the picker opens — without this the
   * painted cells would go dark while the admin is still looking at the
   * picker asking what to put in them.
   */
  pendingPaint: { officialId: string; cellStarts: Set<string> } | null
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
  pendingPaint,
  onPersonDragStart,
  onPersonDragEnter,
  onTimeOffClick,
  onCellClick,
  pendingCells,
}: ByPersonGridProps) {
  const { t } = useTranslation('admin')
  const { scrollRef, isScrolled } = useHorizontalScrollShadow()
  const stickyEdgeHidden = isScrolled ? '' : STICKY_COL_SHADOW_HIDDEN

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
      ref={scrollRef}
      className={`scheduling-scroll-container ${CARD_SURFACE} overflow-x-auto overflow-y-auto max-h-[70vh] relative`}
    >
      <table className="w-full border-collapse text-sm table-fixed">
        <thead>
          <tr>
            <th
              className={`sticky top-0 left-0 z-30 bg-white text-left pl-4 pr-5 py-3 text-xs font-semibold uppercase tracking-label text-ink-faint w-40 border-b border-edge ${STICKY_COL_SHADOW} ${stickyEdgeHidden}`}
            >
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
            // Which hatch, if any, each cell of this row draws — computed once
            // for the whole row so a cell can see its neighbours. A run is a
            // stretch of the SAME kind: an admin-recorded absence sitting next
            // to a self-declared one is two blocks, not one, because they say
            // different things.
            const rowHatch = slots.map((slot) => {
              const slotStart = slot.toISOString()
              if (assignmentMap.has(`${official.id}:${slotStart}`)) return null
              if (!activeSlotSet.has(slotStart)) return 'closed'
              const key = `${official.id}:${slotStart}`
              if (!unavailableSlots.has(key)) return null
              return dominantAuthor(periodsByCell.get(key) ?? []) === 'tenant_admin'
                ? 'timeOffAdmin'
                : 'timeOffSelf'
            })
            return (
              <tr key={official.id} className="border-b border-edge-soft last:border-0">
                <td
                  className={`sticky left-0 z-10 bg-white pl-4 pr-5 py-3 ${STICKY_COL_SHADOW} ${stickyEdgeHidden}`}
                >
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
                  // Who recorded the absence this shift sits on, so the
                  // badge below is tinted the same as the block would have
                  // been — amber for the official's own, slate for ours.
                  const clashAuthor =
                    isUnavailable && assignment
                      ? dominantAuthor(periodsByCell.get(cellKey) ?? [])
                      : null
                  const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0

                  // A blocked cell is drawn as exactly the same box as a
                  // shift card — `h-10 w-full` inside the cell's own padding —
                  // so the two line up by construction. Earlier versions
                  // painted the run as one absolutely positioned overlay
                  // spanning several columns, which could never agree with
                  // the cards: an overlay escapes the cell's padding box, and
                  // its width had to be guessed in px the `table-fixed
                  // w-full` layout does not actually use.
                  const hatch = rowHatch[slotArrIdx]
                  const sameAsLeft = hatch !== null && rowHatch[slotArrIdx - 1] === hatch
                  const sameAsRight = hatch !== null && rowHatch[slotArrIdx + 1] === hatch
                  // A run reads as one block: its interior corners go square
                  // and the `px-1` gap between its own cells is removed, so
                  // the fill is continuous. Its OUTER edges keep both, which
                  // is what lines the run up with the shift cards beside it.
                  const seamPadding = `${sameAsLeft ? 'pl-0' : 'pl-1'} ${
                    sameAsRight ? 'pr-0' : 'pr-1'
                  }`
                  const runEdges = runEdgeClasses(sameAsLeft, sameAsRight)
                  // Only the run's outer sides carry a border: one on an
                  // interior edge would draw a line through the middle of
                  // what should read as a single block.
                  const runBorder =
                    hatch === 'closed'
                      ? ''
                      : `border-y ${sameAsLeft ? '' : 'border-l'} ${sameAsRight ? '' : 'border-r'}`
                  // The icon marks the run once, in its middle cell, rather
                  // than repeating in every cell of a long absence.
                  let runLength = 0
                  let runStartIdx = slotArrIdx
                  if (hatch !== null) {
                    while (rowHatch[runStartIdx - 1] === hatch) runStartIdx--
                    while (rowHatch[runStartIdx + runLength] === hatch) runLength++
                  }
                  const isRunMiddle =
                    hatch !== null && slotArrIdx === runStartIdx + Math.floor((runLength - 1) / 2)
                  // A closed operating window keeps its grey hatch: it is a
                  // different kind of fact from a person being unavailable,
                  // and the two must not converge on one look.
                  const runFill =
                    hatch === 'timeOffAdmin'
                      ? TIME_OFF_FILL.admin
                      : hatch === 'timeOffSelf'
                        ? TIME_OFF_FILL.self
                        : ''
                  const runIconTint =
                    hatch === 'timeOffAdmin'
                      ? TIME_OFF_ICON.admin
                      : hatch === 'timeOffSelf'
                        ? TIME_OFF_ICON.self
                        : ''

                  // Double-booking is a warning and keeps its orange styling —
                  // the work-area palette is decorative and must not mask it.
                  const color = ws ? (wsColors.get(ws.id) ?? WORK_AREA_COLORS[0]) : undefined
                  // Double-booking outranks an absence. Both are now hard —
                  // the save action refuses either — but a cell that is
                  // already assigned twice is the one an admin has to act on,
                  // and two warning styles on one cell read as neither.
                  // A shift laid over someone's time off used to be marked
                  // with an orange ring. The ring said "something is wrong
                  // here" without saying what, and now that an absence is
                  // drawn as a filled block with a calendar icon, a shift
                  // covering one lost every visual tie to the thing it
                  // clashes with. The corner badge below says it in the same
                  // language instead, so the ring is redundant.
                  const cellStyle = assignment
                    ? isDoubleBooked
                      ? 'bg-orange-50 border border-orange-200'
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
                    (personDrag !== null &&
                      personDrag.officialId === official.id &&
                      slotArrIdx >= Math.min(personDrag.startIdx, personDrag.currentIdx) &&
                      slotArrIdx <= Math.max(personDrag.startIdx, personDrag.currentIdx)) ||
                    (pendingPaint !== null &&
                      pendingPaint.officialId === official.id &&
                      pendingPaint.cellStarts.has(slotStart))

                  return (
                    <td key={slotStart} className={`relative py-2 align-top ${seamPadding}`}>
                      {/* The same box a shift card occupies, so a blocked
                          cell starts and ends exactly where the cards around
                          it do. */}
                      {hatch !== null && (
                        <div
                          aria-hidden
                          className={`flex h-10 w-full items-center justify-center ${runEdges} ${runFill} ${runBorder}`}
                          style={hatch === 'closed' ? STRIPED_UNAVAILABLE_STYLE : undefined}
                        >
                          {isRunMiddle && runIconTint && (
                            <CalendarOff className={`size-4 ${runIconTint}`} aria-hidden="true" />
                          )}
                        </div>
                      )}
                      {/* Corner badge rather than anything inline: the card's
                          two lines are already tight, and a mark that overlaps
                          the edge reads as applied TO the shift — which is
                          what a clash is. Sits outside the button because the
                          card clips its own overflow. */}
                      {clashAuthor && (
                        <span
                          className={`pointer-events-none absolute right-0 top-1 z-20 flex size-4 items-center justify-center rounded-full border bg-white ${
                            clashAuthor === 'tenant_admin' ? 'border-slate-300' : 'border-amber-200'
                          }`}
                        >
                          <CalendarOff
                            className={`size-2.5 ${
                              clashAuthor === 'tenant_admin'
                                ? TIME_OFF_ICON.admin
                                : TIME_OFF_ICON.self
                            }`}
                            aria-hidden="true"
                          />
                        </span>
                      )}
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
                            // Overlaid on the block rather than placed after
                            // it: both sit in this one cell, so a hit area in
                            // the normal flow would stack below the block and
                            // make the row twice as tall. Absolute keeps it
                            // out of the flow while still covering exactly
                            // the block's box.
                            //
                            // Transparent, and no border of its own: the
                            // block beneath paints the fill and the edge.
                            // This is only a per-slot hit area, so the popup
                            // knows which slot was clicked.
                            // `inset-0` plus the cell's own padding, because
                            // that padding is not constant: it collapses to
                            // zero inside a run so the fill stays continuous.
                            // A fixed inset would miss the block in exactly
                            // those cells.
                            className={`absolute inset-0 z-10 my-2 transition-opacity hover:opacity-75 ${seamPadding}`}
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
                      ) : null}
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
