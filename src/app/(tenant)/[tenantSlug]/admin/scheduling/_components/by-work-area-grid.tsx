import { MapPin } from 'lucide-react'
import React, { useMemo } from 'react'
import { Skeleton } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { isWithinWindow, formatSlotLabel, shortName } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import {
  WORK_AREA_COLORS,
  workAreaBorderColor,
  workAreaColorMap,
  workAreaDotColor,
} from '@/lib/theme/work-area-colors'
import { STRIPED_UNAVAILABLE_STYLE, getOverflowBySlot, runEdgeClasses } from './grid-helpers'
import type { WorkstationData, OfficialData, LocalAssignment } from './scheduling-types'
import { STICKY_COL_SHADOW, STICKY_COL_SHADOW_HIDDEN } from './scheduling-types'
import { SchedulingCellLegend } from './scheduling-legend'
import { useHorizontalScrollShadow } from './use-horizontal-scroll-shadow'
import { useStickyHeaderOffset } from './use-sticky-header-offset'

interface ByWorkAreaGridProps {
  slots: Date[]
  granularityMin: number
  officials: OfficialData[]
  stageWorkstations: WorkstationData[]
  activeAssignments: LocalAssignment[]
  overCapacityCells: Set<string>
  expandedWorkAreas: Set<string>
  onToggleExpand: (wsId: string) => void
  onWsExpandedSlotClick: (wsId: string, wsName: string, slotIndex: number, slot: Date) => void
  onOverflowClick: (overflowAssignments: LocalAssignment[], anchor: HTMLElement) => void
  wsDrag: {
    workstationId: string
    slotIndex: number
    startIdx: number
    currentIdx: number
  } | null
  onWsDragStart: (wsId: string, wsName: string, slotIndex: number, idx: number) => void
  onWsDragEnter: (wsId: string, slotIndex: number, idx: number) => void
  dragOfficialPicker: {
    workstationId: string
    slotIndex: number
    cellStarts: string[]
  } | null
  pendingCells: Set<string>
}

export function ByWorkAreaGrid({
  slots,
  granularityMin,
  officials,
  stageWorkstations,
  activeAssignments,
  overCapacityCells,
  expandedWorkAreas,
  onToggleExpand,
  onWsExpandedSlotClick,
  onOverflowClick,
  wsDrag,
  onWsDragStart,
  onWsDragEnter,
  dragOfficialPicker,
  pendingCells,
}: ByWorkAreaGridProps) {
  const { t } = useTranslation('admin')
  const { scrollRef, isScrolled } = useHorizontalScrollShadow()
  const stickyEdgeHidden = isScrolled ? '' : STICKY_COL_SHADOW_HIDDEN
  const { headerRef, headerOffset } = useStickyHeaderOffset()

  const countMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of activeAssignments) {
      const key = `${a.workstation_id}:${a.timeslot_start}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return map
  }, [activeAssignments])

  // (wsId:slotStart:slotIndex) → assignment
  const slotIndexMap = useMemo(() => {
    const map = new Map<string, LocalAssignment>()
    for (const a of activeAssignments) {
      if (a.slot_index !== null) {
        map.set(`${a.workstation_id}:${a.timeslot_start}:${a.slot_index}`, a)
      }
    }
    return map
  }, [activeAssignments])

  // Official name lookup by id
  // One colour per work area across the whole grid, so no two rows visible at
  // the same time share one.
  const colorMap = useMemo(
    () => workAreaColorMap(stageWorkstations.map((ws) => ({ id: ws.id, color: ws.color }))),
    [stageWorkstations]
  )

  const officialNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of officials) map.set(o.id, o.name)
    return map
  }, [officials])

  if (stageWorkstations.length === 0) {
    return (
      <EmptyStateCard
        Icon={MapPin}
        title={t('scheduling.noWorkAreasTitle')}
        description={t('scheduling.noWorkAreasHint')}
      />
    )
  }

  return (
    <div className={`${CARD_SURFACE} overflow-hidden`}>
      <SchedulingCellLegend view="by-work-area" />
      <div
        ref={scrollRef}
        className="scheduling-scroll-container overflow-x-auto overflow-y-auto max-h-[70vh]"
      >
        <table className="w-full border-collapse text-sm table-fixed">
          <thead>
            <tr ref={headerRef}>
              <th
                className={`sticky top-0 left-0 z-40 bg-white text-left pl-4 pr-5 py-3 text-xs font-semibold uppercase tracking-label text-ink-faint w-44 border-b border-edge ${STICKY_COL_SHADOW} ${stickyEdgeHidden}`}
              >
                {t('scheduling.colWorkArea')}
              </th>
              {slots.map((slot) => (
                <th
                  key={slot.toISOString()}
                  className="sticky top-0 z-30 w-20 border-b border-edge-soft bg-white px-1 py-3 text-center text-[13px] font-semibold text-ink"
                >
                  {formatSlotLabel(slot)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stageWorkstations.map((ws) => {
              const isExpanded = expandedWorkAreas.has(ws.id)
              const color = colorMap.get(ws.id) ?? WORK_AREA_COLORS[0]

              const overflowBySlot = getOverflowBySlot(
                activeAssignments,
                ws.id,
                ws.capacity_ceiling
              )
              const hasOverflow = overflowBySlot.size > 0

              // Out-of-window hatching depends only on this work area's
              // operating windows, so one pass per work area serves the summary
              // row and every numbered slot row underneath it. Index i holds
              // how far into a closed run slot i sits, or null when it is open.
              const closedRunOffsets = slots.map(() => null as number | null)
              for (let i = 0; i < slots.length; i++) {
                if (isWithinWindow(slots[i], granularityMin, ws.workstation_operating_windows)) {
                  continue
                }
                const prev = i > 0 ? closedRunOffsets[i - 1] : null
                closedRunOffsets[i] = prev === null ? 0 : prev + 1
              }
              const closedEdges = (i: number) =>
                runEdgeClasses(
                  i > 0 && closedRunOffsets[i - 1] !== null,
                  i < slots.length - 1 && closedRunOffsets[i + 1] !== null
                )
              // Pin the summary row under the time header while its own slot
              // rows scroll past, so a numbered row like "#13" always has its
              // work area named directly above it. Only while expanded: a
              // collapsed row has nothing to scroll past, and pinning every row
              // at once would stack them all against the header.
              const pinSummary = isExpanded
              const pinCell = pinSummary ? 'sticky z-10' : ''
              // Park the row a few pixels high on purpose, so it tucks *behind*
              // the header rather than trying to meet its bottom edge exactly.
              // The header paints above it (z-30/40 vs z-10/20) and is opaque,
              // so the overlap is invisible — whereas landing even a subpixel
              // low opens a seam the slot rows show through. Overshooting makes
              // the result independent of how exactly the header measures.
              const pinStyle = pinSummary ? { top: Math.max(0, headerOffset - 4) } : undefined

              const closedSeam = (i: number) =>
                `${i > 0 && closedRunOffsets[i - 1] !== null ? 'pl-0' : 'pl-1'} ${
                  i < slots.length - 1 && closedRunOffsets[i + 1] !== null ? 'pr-0' : 'pr-1'
                }`

              return (
                <React.Fragment key={ws.id}>
                  {/* Summary row (always visible) */}
                  <tr className="border-b border-edge-soft">
                    <td
                      className={`sticky left-0 ${pinSummary ? 'z-20' : 'z-10'} bg-white pl-3 pr-5 py-3 ${STICKY_COL_SHADOW} ${stickyEdgeHidden}`}
                      style={pinStyle}
                    >
                      <div className="flex items-center gap-2">
                        <Button
                          isIconOnly
                          variant="light"
                          size="sm"
                          onPress={() => onToggleExpand(ws.id)}
                          aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          className="w-5 h-5 min-w-0 text-gray-400 shrink-0"
                        >
                          <svg
                            className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </Button>
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: workAreaDotColor(color) }}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink" title={ws.name}>
                            {ws.name}
                          </div>
                          <div className="text-xs text-ink-label">
                            {t('workstations.upTo', { n: ws.capacity_ceiling })}
                          </div>
                        </div>
                      </div>
                    </td>
                    {slots.map((slot, slotArrIdx) => {
                      const slotStart = slot.toISOString()
                      const key = `${ws.id}:${slotStart}`
                      const count = countMap.get(key) ?? 0
                      const inWindow = isWithinWindow(
                        slot,
                        granularityMin,
                        ws.workstation_operating_windows
                      )
                      const isOver = overCapacityCells.has(key)

                      if (!inWindow) {
                        return (
                          <td
                            key={slotStart}
                            className={`bg-white py-2 ${pinCell} ${closedSeam(slotArrIdx)}`}
                            style={pinStyle}
                          >
                            <div
                              className={`w-full h-10 ${closedEdges(slotArrIdx)}`}
                              style={STRIPED_UNAVAILABLE_STYLE}
                            />
                          </td>
                        )
                      }
                      return (
                        <td
                          key={slotStart}
                          className={`bg-white px-1 py-2 ${pinCell}`}
                          style={pinStyle}
                        >
                          <div
                            className={`flex w-full h-10 flex-col items-center justify-center rounded-md border px-2 text-xs font-medium text-center ${
                              isOver
                                ? 'bg-orange-50 border-orange-200 text-orange-700'
                                : count === 0
                                  ? 'border-edge bg-white text-ink-label'
                                  : ''
                            }`}
                            // A filled cell takes its work area's colour, with a
                            // softened border rather than the full-strength hue —
                            // the handoff asks for a calm grid, not an alarm-like
                            // one. Over-capacity keeps the orange warning styling,
                            // which carries meaning the palette must not override.
                            style={
                              !isOver && count > 0
                                ? {
                                    backgroundColor: color.bg,
                                    borderColor: workAreaBorderColor(color),
                                    color: color.fg,
                                  }
                                : undefined
                            }
                          >
                            {count} / {ws.capacity_ceiling}
                            {isOver && (
                              <div className="text-[10px] font-normal text-orange-500 leading-none">
                                {t('scheduling.overCapacityBadge')}
                              </div>
                            )}
                          </div>
                        </td>
                      )
                    })}
                  </tr>

                  {/* Numbered slot rows (visible when expanded) */}
                  {isExpanded &&
                    Array.from({ length: ws.capacity_ceiling }, (_, i) => i + 1).map((slotIdx) => (
                      <tr
                        key={`${ws.id}-slot-${slotIdx}`}
                        className="border-b border-edge-soft bg-gray-50/40"
                      >
                        <td
                          className={`sticky left-0 z-10 bg-gray-50 pl-12 pr-5 py-1.5 ${STICKY_COL_SHADOW} ${stickyEdgeHidden}`}
                        >
                          <span className="font-mono text-xs text-ink-label">#{slotIdx}</span>
                        </td>
                        {slots.map((slot, slotArrIdx) => {
                          const slotStart = slot.toISOString()
                          const inWindow = isWithinWindow(
                            slot,
                            granularityMin,
                            ws.workstation_operating_windows
                          )
                          const assignment = slotIndexMap.get(`${ws.id}:${slotStart}:${slotIdx}`)
                          const officialName = assignment
                            ? (officialNameMap.get(assignment.official_id) ?? '—')
                            : undefined
                          const inDragRange =
                            (!!wsDrag &&
                              wsDrag.workstationId === ws.id &&
                              wsDrag.slotIndex === slotIdx &&
                              slotArrIdx >= Math.min(wsDrag.startIdx, wsDrag.currentIdx) &&
                              slotArrIdx <= Math.max(wsDrag.startIdx, wsDrag.currentIdx)) ||
                            (!!dragOfficialPicker &&
                              dragOfficialPicker.workstationId === ws.id &&
                              dragOfficialPicker.slotIndex === slotIdx &&
                              dragOfficialPicker.cellStarts.includes(slotStart))

                          if (!inWindow) {
                            return (
                              <td key={slotStart} className={`py-1.5 ${closedSeam(slotArrIdx)}`}>
                                <div
                                  onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                  className={`w-full h-10 ${closedEdges(slotArrIdx)}`}
                                  style={STRIPED_UNAVAILABLE_STYLE}
                                />
                              </td>
                            )
                          }
                          const isPending = pendingCells.has(`w:${ws.id}:${slotIdx}:${slotStart}`)

                          return (
                            <td key={slotStart} className="px-1 py-1.5">
                              {isPending ? (
                                <Skeleton className="w-full h-10 rounded-md" />
                              ) : assignment && officialName ? (
                                <button
                                  onClick={() =>
                                    onWsExpandedSlotClick(ws.id, ws.name, slotIdx, slot)
                                  }
                                  onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                  title={officialName}
                                  // The assigned-person cell carries the same
                                  // work-area colour as the summary row above it,
                                  // so a glance down a column reads as one area.
                                  // White ground keeps the name legible; the hue
                                  // lives in the border and the text.
                                  style={{
                                    borderColor: workAreaBorderColor(color),
                                    color: color.fg,
                                  }}
                                  className={`w-full h-10 truncate rounded-md border bg-white px-2 text-center text-xs transition-colors hover:brightness-95 ${inDragRange ? 'ring-2 ring-tenant-primary' : ''}`}
                                >
                                  {shortName(officialName)}
                                </button>
                              ) : (
                                <button
                                  onPointerDown={() =>
                                    onWsDragStart(ws.id, ws.name, slotIdx, slotArrIdx)
                                  }
                                  onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                  className={`w-full h-10 rounded-md border transition-colors ${
                                    inDragRange
                                      ? 'border-tenant-primary bg-tenant-primary-tint'
                                      : 'border-transparent hover:border-edge hover:bg-white'
                                  }`}
                                />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}

                  {/* Overflow row — assignments with slot_index > capacity_ceiling */}
                  {isExpanded && hasOverflow && (
                    <tr
                      key={`${ws.id}-overflow`}
                      className="border-b border-edge-soft bg-orange-50/20"
                    >
                      <td
                        className={`sticky left-0 z-10 bg-orange-50 pl-12 pr-5 py-1.5 ${STICKY_COL_SHADOW} ${stickyEdgeHidden}`}
                      >
                        <span className="text-xs text-orange-500 font-medium">
                          {t('scheduling.overflowRow')}
                        </span>
                      </td>
                      {slots.map((slot) => {
                        const slotStart = slot.toISOString()
                        const overflows = overflowBySlot.get(slotStart) ?? []
                        return (
                          <td key={slotStart} className="px-1 py-1.5">
                            {overflows.length > 0 && (
                              <button
                                onClick={(e) => onOverflowClick(overflows, e.currentTarget)}
                                className="w-full h-10 rounded-md bg-orange-100 border border-orange-200 flex items-center justify-center text-xs text-orange-600 font-medium hover:brightness-95 transition-colors"
                              >
                                +{overflows.length}
                              </button>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
