import { SelectItem, Checkbox } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Time } from '@internationalized/date'
import { useTranslation } from '@/lib/i18n/client'
import { Select, TimeInput } from '@/components/ui/form-fields'
import { hhmmToTime, timeToHHMM, type TimeWindow } from '../_utils'

interface Props {
  windows: TimeWindow[]
  errors: Record<number, string> | undefined
  isMultiDay: boolean
  stageDays: string[]
  canMatchStageHours: boolean
  minStartFor: string | undefined
  maxEndFor: (limitToDay: string | null) => string | undefined
  onUpdateWindow: (index: number, field: 'start' | 'end', value: string) => void
  onRemoveWindow: (index: number) => void
  onAddWindow: () => void
  onToggleLimitToDay: (index: number) => void
  onSetLimitDay: (index: number, day: string) => void
  onMatchStageHours: () => void
}

export function OperatingWindowsEditor({
  windows,
  errors,
  isMultiDay,
  stageDays,
  canMatchStageHours,
  minStartFor,
  maxEndFor,
  onUpdateWindow,
  onRemoveWindow,
  onAddWindow,
  onToggleLimitToDay,
  onSetLimitDay,
  onMatchStageHours,
}: Props) {
  const { t } = useTranslation('admin')

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          {t('workstations.operatingWindowsLabel')}
        </h2>
        {canMatchStageHours && (
          <Button
            variant="light"
            size="sm"
            onPress={onMatchStageHours}
            className="text-default-500"
          >
            {t('workstations.matchStageHours')}
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-gray-400">{t('workstations.operatingWindowMidnightHint')}</p>
      <div className="space-y-3">
        {windows.map((w, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 ${errors?.[i] ? 'border-red-300' : 'border-gray-200'}`}
          >
            <div className="flex items-center gap-2">
              <TimeInput
                aria-label={t('workstations.windowStartLabel')}
                value={hhmmToTime(w.start) ?? null}
                minValue={hhmmToTime(minStartFor ?? '')}
                validationBehavior="aria"
                isInvalid={!!errors?.[i]}
                onChange={(val) => onUpdateWindow(i, 'start', timeToHHMM(val as Time | null))}
                hourCycle={24}
                className="flex-1"
              />
              <span className="text-gray-400">–</span>
              <TimeInput
                aria-label={t('workstations.windowEndLabel')}
                value={hhmmToTime(w.end) ?? null}
                maxValue={hhmmToTime(maxEndFor(w.limitToDay) ?? '')}
                validationBehavior="aria"
                isInvalid={!!errors?.[i]}
                onChange={(val) => onUpdateWindow(i, 'end', timeToHHMM(val as Time | null))}
                hourCycle={24}
                className="flex-1"
              />
              <Button
                variant="light"
                size="sm"
                onPress={() => onRemoveWindow(i)}
                className="text-default-400 whitespace-nowrap"
              >
                {t('workstations.removeWindow')}
              </Button>
            </div>
            {errors?.[i] && <p className="mt-1.5 text-xs text-red-500">{errors[i]}</p>}
            {isMultiDay && (
              <div className="mt-2.5 space-y-2">
                <Checkbox
                  isSelected={w.limitToDay !== null}
                  onValueChange={() => onToggleLimitToDay(i)}
                  size="sm"
                  classNames={{ label: 'text-sm text-gray-600' }}
                >
                  {t('workstations.limitToOneDay')}
                </Checkbox>
                {w.limitToDay !== null && (
                  <Select
                    selectedKeys={[w.limitToDay]}
                    onSelectionChange={(keys) => onSetLimitDay(i, Array.from(keys)[0] as string)}
                    aria-label={t('workstations.limitToOneDay')}
                  >
                    {stageDays.map((day) => (
                      <SelectItem key={day} textValue={day}>
                        {day}
                      </SelectItem>
                    ))}
                  </Select>
                )}
              </div>
            )}
          </div>
        ))}
        <Button variant="light" size="sm" onPress={onAddWindow} className="text-default-500 px-0">
          {t('workstations.addWindow')}
        </Button>
      </div>
    </section>
  )
}
