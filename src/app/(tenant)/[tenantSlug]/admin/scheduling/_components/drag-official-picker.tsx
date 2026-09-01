import { Button, ScrollShadow } from '@heroui/react'
import { initials } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import type { OfficialData } from './scheduling-types'
import type { DragOfficialPicker as DragOfficialPickerState } from './use-scheduling-grid-interaction'

interface DragOfficialPickerProps {
  dragOfficialPicker: NonNullable<DragOfficialPickerState>
  availableOfficials: OfficialData[]
  onPick: (officialId: string) => void
}

export function DragOfficialPicker({
  dragOfficialPicker,
  availableOfficials,
  onPick,
}: DragOfficialPickerProps) {
  const { t } = useTranslation('admin')

  return (
    <div
      className="fixed w-52 bg-white border border-gray-200 rounded-md shadow-lg z-50"
      style={{
        top: dragOfficialPicker.anchorTop,
        left: dragOfficialPicker.anchorLeft,
        transform: 'translateY(calc(-100% - 4px))',
      }}
      data-drag-official-picker
    >
      <p className="px-3 pt-2 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
        {t('scheduling.dragPaintPickPerson', { count: dragOfficialPicker.cellStarts.length })}
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
