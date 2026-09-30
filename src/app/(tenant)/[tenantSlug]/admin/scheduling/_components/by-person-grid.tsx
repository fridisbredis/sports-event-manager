import { Users } from 'lucide-react'
import { useMemo } from 'react'
import { ScrollShadow, Skeleton } from '@heroui/react'
import { Button } from '@/components/ui/button'
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
                {slots.map((slot) => {
                  const slotStart = slot.toISOString()
                  const assignment = assignmentMap.get(`${official.id}:${slotStart}`)
                  const ws = assignment
                    ? stageWorkstations.find((w) => w.id === assignment.workstation_id)
                    : undefined
                  const isDoubleBooked = doubleBookedOfficials.has(`${official.id}:${slotStart}`)
                  const wsCount = ws ? (countMap.get(`${ws.id}:${slotStart}`) ?? 0) : 0

                  // Double-booking is a warning and keeps its orange styling —
                  // the work-area palette is decorative and must not mask it.
                  const color = ws ? (wsColors.get(ws.id) ?? WORK_AREA_COLORS[0]) : undefined
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

                  return (
                    <td key={slotStart} className="px-1 py-2 relative">
                      {isPending ? (
                        <Skeleton className="w-full h-10 rounded-md" />
                      ) : assignment ? (
                        <button
                          onClick={(e) =>
                            onCellClick(official.id, slot, undefined, e.currentTarget)
                          }
                          className={`flex w-full h-10 flex-col items-center justify-center gap-1 rounded-md px-1 font-medium transition-colors hover:brightness-95 ${cellStyle} ${cellColors ? '' : 'text-gray-700'}`}
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
                        <button
                          onClick={(e) =>
                            onCellClick(official.id, slot, undefined, e.currentTarget)
                          }
                          className="w-full h-10 rounded-md border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-colors"
                        />
                      ) : (
                        <div className="w-full h-10 rounded-md" style={STRIPED_UNAVAILABLE_STYLE} />
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
              <ScrollShadow className="flex flex-col max-h-64 overflow-y-auto">
                {openWorkstations.map((ws) => {
                  const count = countMap.get(`${ws.id}:${pickerCell.slotStart}`) ?? 0
                  return (
                    <Button
                      key={ws.id}
                      variant="light"
                      size="sm"
                      className="w-full h-8 shrink-0 justify-between rounded-none px-3"
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
