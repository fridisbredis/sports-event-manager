import { SelectItem, Checkbox } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/ui/link-button'
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
      <div className="mb-1 flex items-center justify-between">
        <h2 className="section-label">{t('workstations.operatingWindowsLabel')}</h2>
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
      <p className="mb-3 text-sm text-ink-soft">{t('workstations.operatingWindowMidnightHint')}</p>
      <div className="space-y-3">
        {windows.map((w, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 ${errors?.[i] ? 'border-red-300' : 'border-edge'}`}
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
              <LinkButton
                size="sm"
                tone="danger"
                onPress={() => onRemoveWindow(i)}
                className="whitespace-nowrap"
              >
                {t('workstations.removeWindow')}
              </LinkButton>
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
        {/* A work area with no window never reaches the schedule at all, so
            an empty list has to say that rather than look like a section that
            failed to load. Dashed, matching the other "nothing here yet"
            placeholders in the admin UI. */}
        {windows.length === 0 && (
          <p className="rounded-lg border border-dashed border-edge-field px-4 py-5 text-center text-sm text-ink-soft">
            {t('workstations.noOperatingWindows')}
          </p>
        )}
      </div>
      <div className="mt-3">
        <LinkButton onPress={onAddWindow}>{t('workstations.addWindow')}</LinkButton>
      </div>
    </section>
  )
}
