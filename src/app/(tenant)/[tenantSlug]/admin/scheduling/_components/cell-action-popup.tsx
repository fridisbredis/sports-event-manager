import { useTranslation } from '@/lib/i18n/client'
import { Button } from '@/components/ui/button'
import { resolveCellActionLabel } from './grid-helpers'
import type { WorkstationData, OfficialData, LocalAssignment } from './scheduling-types'
import type { CellActionCell } from './use-scheduling-grid-interaction'

interface CellActionPopupProps {
  cellActionCell: NonNullable<CellActionCell>
  officials: OfficialData[]
  workstations: WorkstationData[]
  onAction: (action: 'remove' | 'assigned', assignment: LocalAssignment) => void
}

export function CellActionPopup({
  cellActionCell,
  officials,
  workstations,
  onAction,
}: CellActionPopupProps) {
  const { t } = useTranslation('admin')

  return (
    <div
      className="fixed bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-[200px]"
      style={{
        top: cellActionCell.anchorBottom ?? 0,
        left: cellActionCell.anchorLeft ?? 0,
      }}
      data-cell-action
    >
      {cellActionCell.assignments.length > 1 && (
        <p className="px-3 pt-2.5 pb-1 text-xs text-gray-400 font-medium uppercase tracking-wider">
          {cellActionCell.labelBy === 'official'
            ? t('scheduling.overflowPickToRemove')
            : t('scheduling.conflictPickToRemove')}
        </p>
      )}
      {cellActionCell.assignments.map((assignment, i) => {
        const label = resolveCellActionLabel(
          cellActionCell.labelBy,
          assignment,
          officials,
          workstations
        )
        return (
          <div key={assignment.id ?? i} className="border-t border-gray-100 py-1 first:border-t-0">
            <div className="flex items-center justify-between gap-2 px-3 py-1">
              <span className="text-xs text-gray-400 font-medium uppercase tracking-wider truncate max-w-[160px]">
                {label}
              </span>
              <Button
                color="danger"
                variant="light"
                size="sm"
                className="shrink-0 px-2 hover:bg-red-50"
                onPress={() => onAction('remove', assignment)}
              >
                {t('scheduling.actionRemove')}
              </Button>
            </div>
            {assignment.status !== 'assigned' && (
              <Button
                variant="light"
                size="sm"
                className="w-full justify-start rounded-none px-3 hover:bg-gray-50"
                onPress={() => onAction('assigned', assignment)}
              >
                {t('scheduling.actionMarkAssigned')}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
