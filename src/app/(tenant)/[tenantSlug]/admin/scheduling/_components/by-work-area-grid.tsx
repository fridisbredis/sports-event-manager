import React, { useMemo } from 'react'
import { Button, Skeleton } from '@heroui/react'
import { isWithinWindow, formatSlotLabel, shortName } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { STRIPED_UNAVAILABLE_STYLE, getOverflowBySlot } from './grid-helpers'
import type { WorkstationData, OfficialData, LocalAssignment } from './scheduling-types'

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
  const officialNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const o of officials) map.set(o.id, o.name)
    return map
  }, [officials])

  if (stageWorkstations.length === 0) {
    return (
      <div className="border border-gray-200 rounded-md bg-white py-12 text-center text-sm text-gray-500">
        {t('scheduling.noWorkAreas')}
      </div>
    )
  }

  const hasOutOfWindow = stageWorkstations.some((ws) => ws.workstation_operating_windows.length > 0)

  return (
    <div className="scheduling-scroll-container border border-gray-200 rounded-md bg-white overflow-x-auto overflow-y-auto max-h-[70vh]">
      {hasOutOfWindow && (
        <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="w-8 h-4 rounded-sm bg-gray-100 border border-gray-200 inline-block" />
            {t('scheduling.legendAssignable')}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="w-8 h-4 rounded-sm inline-block border border-gray-200"
              style={STRIPED_UNAVAILABLE_STYLE}
            />
            {t('scheduling.legendOutsideWindow')}
          </span>
        </div>
      )}
      <table className="w-full border-collapse text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-white text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-44 border-r border-b border-gray-100">
              {t('scheduling.colWorkArea')}
            </th>
            {slots.map((slot) => (
              <th
                key={slot.toISOString()}
                className="sticky top-0 z-20 bg-white text-center px-1 py-3 text-xs font-medium text-gray-500 w-20 border-b border-gray-100"
              >
                {formatSlotLabel(slot)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stageWorkstations.map((ws) => {
            const isExpanded = expandedWorkAreas.has(ws.id)

            const overflowBySlot = getOverflowBySlot(activeAssignments, ws.id, ws.capacity_ceiling)
            const hasOverflow = overflowBySlot.size > 0

            return (
              <React.Fragment key={ws.id}>
                {/* Summary row (always visible) */}
                <tr className="border-b border-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-3 border-r border-gray-100">
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
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate" title={ws.name}>
                          {ws.name}
                        </div>
                        <div className="text-xs text-gray-400">
                          {t('workstations.upTo', { n: ws.capacity_ceiling })}
                        </div>
                      </div>
                    </div>
                  </td>
                  {slots.map((slot) => {
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
                        <td key={slotStart} className="px-1 py-2">
                          <div
                            className="w-full h-10 rounded-md"
                            style={STRIPED_UNAVAILABLE_STYLE}
                          />
                        </td>
                      )
                    }
                    return (
                      <td key={slotStart} className="px-1 py-2">
                        <div
                          className={`flex w-full h-10 flex-col items-center justify-center rounded-md px-2 text-xs font-medium text-center ${
                            isOver
                              ? 'bg-orange-50 border border-orange-200 text-orange-700'
                              : count === 0
                                ? 'bg-white border border-gray-200 text-gray-400'
                                : 'bg-gray-100 border border-gray-200 text-gray-700'
                          }`}
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
                      className="border-b border-gray-50 bg-gray-50/40"
                    >
                      <td className="sticky left-0 z-10 bg-gray-50 pl-12 pr-3 py-1.5 border-r border-gray-100">
                        <span className="text-xs text-gray-400 font-mono">#{slotIdx}</span>
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
                            <td key={slotStart} className="px-1 py-1.5">
                              <div
                                onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                className="w-full h-10 rounded-md opacity-30"
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
                                onClick={() => onWsExpandedSlotClick(ws.id, ws.name, slotIdx, slot)}
                                onPointerEnter={() => onWsDragEnter(ws.id, slotIdx, slotArrIdx)}
                                title={officialName}
                                className={`w-full h-10 rounded-md border px-2 text-center text-xs truncate transition-colors hover:brightness-95 bg-gray-100 border-gray-200 text-gray-700 ${inDragRange ? 'ring-2 ring-blue-400' : ''}`}
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
                                    ? 'border-blue-300 bg-blue-50'
                                    : 'border-transparent hover:border-gray-200 hover:bg-white'
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
                  <tr key={`${ws.id}-overflow`} className="border-b border-gray-50 bg-orange-50/20">
                    <td className="sticky left-0 z-10 bg-orange-50 pl-12 pr-3 py-1.5 border-r border-gray-100">
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
  )
}
