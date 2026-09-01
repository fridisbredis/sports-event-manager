import { Button, ScrollShadow } from '@heroui/react'
import { formatSlotLabel, initials } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import type { OfficialData, LocalAssignment } from './scheduling-types'
import type { WsPickerCell } from './use-scheduling-grid-interaction'

interface WsPersonPickerProps {
  wsPickerCell: NonNullable<WsPickerCell>
  activeAssignments: LocalAssignment[]
  officials: OfficialData[]
  onPick: (officialId: string) => void
}

// Person picker for the by-work-area expanded view. No `open` call site
// exists anywhere in the codebase yet, so this popup is currently
// unreachable — preserved as-is from before MNT-05a/b; fixing it is out
// of scope for this extraction (see docs/quality-requirements.md F-MNT-05).
export function WsPersonPicker({
  wsPickerCell,
  activeAssignments,
  officials,
  onPick,
}: WsPersonPickerProps) {
  const { t } = useTranslation('admin')

  const slot = new Date(wsPickerCell.slotStart)
  const assignedAtSlot = new Set(
    activeAssignments
      .filter((a) => a.timeslot_start === wsPickerCell.slotStart)
      .map((a) => a.official_id)
  )
  const availableOfficials = officials.filter((off) => !assignedAtSlot.has(off.id))

  return (
    <div
      className="fixed w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50"
      style={{
        top: wsPickerCell.anchorTop,
        left: wsPickerCell.anchorLeft,
        transform: 'translateY(calc(-100% - 4px))',
      }}
      data-ws-picker
    >
      <p className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
        {t('scheduling.assignPerson', {
          slot: formatSlotLabel(slot),
          index: wsPickerCell.slotIndex,
        })}
      </p>
      {availableOfficials.length === 0 ? (
        <p className="px-3 py-2 text-sm text-gray-400">{t('scheduling.noConfirmedOfficials')}</p>
      ) : (
        <ScrollShadow className="flex flex-col max-h-64">
          {availableOfficials.map((off) => (
            <Button
              key={off.id}
              variant="light"
              size="sm"
              className="w-full justify-start rounded-none px-3 hover:bg-gray-50"
              onPress={() => onPick(off.id)}
            >
              <span className="flex items-center gap-2 truncate">
                <span className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-600 shrink-0">
                  {initials(off.name)}
                </span>
                <span className="truncate">{off.name}</span>
              </span>
            </Button>
          ))}
        </ScrollShadow>
      )}
    </div>
  )
}
