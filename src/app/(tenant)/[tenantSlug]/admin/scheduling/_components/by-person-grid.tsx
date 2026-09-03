import { useMemo } from 'react'
import { ScrollShadow, Skeleton } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { isWithinWindow, formatSlotLabel, initials } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { STRIPED_UNAVAILABLE_STYLE } from './grid-helpers'
import type { WorkstationData, OfficialData, LocalAssignment } from './scheduling-types'

interface ByPersonGridProps {
  slots: Date[]
  granularityMin: number
  officials: OfficialData[]
  stageWorkstations: WorkstationData[]
  activeAssignments: LocalAssignment[]
  doubleBookedOfficials: Set<string>
  pickerCell: {
    officialId: string
    slotStart: string
    anchorTop: number
    anchorLeft: number
  } | null
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
  pickerCell,
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
      <div className={`${CARD_SURFACE} py-12 text-center text-sm text-gray-500`}>
        {t('scheduling.noConfirmedOfficials')}
      </div>
    )
  }

  return (
    <div
      className={`scheduling-scroll-container ${CARD_SURFACE} overflow-x-auto overflow-y-auto max-h-[70vh] relative`}
    >
      <table className="w-full border-collapse text-sm table-fixed">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-30 bg-white text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider w-40 border-r border-b border-gray-100">
              {t('scheduling.colOfficial')}
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
          {officials.map((official) => (
            <tr key={official.id} className="border-b border-gray-50 last:border-0">
              <td className="sticky left-0 z-10 bg-white px-4 py-3 border-r border-gray-100">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                    {initials(official.name)}
                  </div>
                  <span className="text-sm text-gray-800 truncate" title={official.name}>
                    {official.name}
                  </span>
                </div>
              </td>
              {slots.map((slot) => {
                const slotStart = slot.toISOString()
                const assignment = assignmentMap.get(`${official.id}:${slotStart}`)
                const ws = assignment
                  ? stageWorkstations.find((w) => w.id === assignment.workstation_id)
                  : undefined
                const isDoubleBooked = doubleBookedOfficials.has(`${official.id}:${slotStart}`)
                const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0

                const cellStyle = assignment
                  ? isDoubleBooked
                    ? 'bg-orange-50 border border-orange-200'
                    : 'bg-gray-100 border border-gray-200'
                  : ''

                const isPending = pendingCells.has(`p:${official.id}:${slotStart}`)

                return (
                  <td key={slotStart} className="px-1 py-2 relative">
                    {isPending ? (
                      <Skeleton className="w-full h-10 rounded-md" />
                    ) : assignment ? (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className={`flex w-full h-10 flex-col items-center justify-center gap-1 rounded-md px-1 font-medium text-gray-700 transition-colors hover:brightness-95 ${cellStyle}`}
                      >
                        <span className="w-full truncate text-center text-[11px] leading-none">
                          {ws?.name ?? '—'}
                        </span>
                        <span
                          className={`shrink-0 text-[10px] leading-none tabular-nums ${isDoubleBooked ? 'text-orange-400' : 'text-gray-400'}`}
                        >
                          {ws ? `${wsCount}/${ws.capacity_ceiling}` : ''}
                          {isDoubleBooked && ' ⊗'}
                        </span>
                      </button>
                    ) : activeSlotSet.has(slotStart) ? (
                      <button
                        onClick={(e) => onCellClick(official.id, slot, undefined, e.currentTarget)}
                        className="w-full h-10 rounded-md border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors"
                      />
                    ) : (
                      <div className="w-full h-10 rounded-md" style={STRIPED_UNAVAILABLE_STYLE} />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {!hasAssignmentsToday && (
        <div className="px-4 py-3 border-t border-gray-50 text-center text-xs text-gray-400">
          {t('scheduling.noAssignmentsToday')}
        </div>
      )}

      {/* Work-area picker */}
      {pickerCell &&
        (() => {
          const slot = new Date(pickerCell.slotStart)
          const openWorkstations = stageWorkstations.filter((ws) =>
            isWithinWindow(slot, granularityMin, ws.workstation_operating_windows)
          )
          if (openWorkstations.length === 0) return null
          return (
            <div
              className="fixed w-48 bg-white border border-gray-200 rounded-md shadow-lg z-50"
              style={{
                top: pickerCell.anchorTop,
                left: pickerCell.anchorLeft,
                transform: 'translateY(calc(-100% - 4px))',
              }}
              data-picker-cell
            >
              <div className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
                {t('scheduling.assignTo')}
              </div>
              <ScrollShadow className="flex flex-col max-h-64">
                {openWorkstations.map((ws) => {
                  const count = countMap.get(`${ws.id}:${pickerCell.slotStart}`) ?? 0
                  return (
                    <Button
                      key={ws.id}
                      variant="light"
                      size="sm"
                      className="w-full justify-between rounded-none px-3"
                      onPress={() => onCellClick(pickerCell.officialId, slot, ws)}
                    >
                      <span className="truncate">{ws.name}</span>
                      <span className="ml-2 text-xs text-gray-400 tabular-nums shrink-0">
                        {count}/{ws.capacity_ceiling}
                      </span>
                    </Button>
                  )
                })}
              </ScrollShadow>
            </div>
          )
        })()}
    </div>
  )
}
