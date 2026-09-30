import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { LISTBOX_ITEM } from '@/components/ui/form-fields'
import { formatDayLabel } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import type { Stage } from './scheduling-types'

export function SchedulingToolbar({
  stages,
  selectedStage,
  selectedStageId,
  onSelectStage,
  availableDays,
  selectedDay,
  onSelectDay,
  dragSaving,
}: {
  stages: Stage[]
  selectedStage: Stage | undefined
  selectedStageId: string
  onSelectStage: (stageId: string) => void
  availableDays: string[]
  selectedDay: string
  onSelectDay: (day: string) => void
  dragSaving: boolean
}) {
  const { t } = useTranslation('admin')
  const dayIndex = availableDays.indexOf(selectedDay)

  return (
    <div className="no-print flex items-center gap-4 mb-6">
      <h1 className="page-title">{t('scheduling.title')}</h1>

      <div className="flex-1" />

      {/* Stage + day selector — grouped together since they're one connected control */}
      <Dropdown>
        <DropdownTrigger>
          <Button
            variant="bordered"
            size="sm"
            endContent={<ChevronDown className="w-4 h-4 text-gray-400" />}
          >
            {selectedStage?.name ?? t('scheduling.selectStage')}
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          selectionMode="single"
          // Shared with the Select fields so hover and the selected row
          // pick up the tenant palette instead of HeroUI's grey.
          itemClasses={{ base: LISTBOX_ITEM }}
          selectedKeys={new Set([selectedStageId])}
          onAction={(key) => onSelectStage(String(key))}
        >
          {stages.map((stage) => (
            <DropdownItem key={stage.id}>{stage.name}</DropdownItem>
          ))}
        </DropdownMenu>
      </Dropdown>

      {availableDays.length > 0 && (
        <div className="flex items-center gap-1">
          <Button
            isIconOnly
            variant="bordered"
            size="sm"
            onPress={() => onSelectDay(availableDays[dayIndex - 1])}
            isDisabled={dayIndex <= 0}
            aria-label={t('scheduling.prevDay')}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-gray-600 border border-gray-200 rounded-md px-3 py-1.5 bg-white min-w-[200px] text-center capitalize">
            {selectedDay ? formatDayLabel(selectedDay) : ''}
          </span>
          <Button
            isIconOnly
            variant="bordered"
            size="sm"
            onPress={() => onSelectDay(availableDays[dayIndex + 1])}
            isDisabled={dayIndex >= availableDays.length - 1}
            aria-label={t('scheduling.nextDay')}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {dragSaving && (
        <span className="text-xs text-gray-400">{t('scheduling.dragPaintSaving')}</span>
      )}

      <Button variant="bordered" size="sm" onPress={() => window.print()}>
        {t('scheduling.print')}
      </Button>
    </div>
  )
}
