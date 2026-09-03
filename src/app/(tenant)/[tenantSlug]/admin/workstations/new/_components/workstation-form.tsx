'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { Input, Textarea } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { createWorkstation } from '../../actions'
import {
  type Stage,
  type TimeWindow,
  getStageDays,
  expandWindows,
  windowDurationMin,
  matchStageHoursWindows,
} from '../../_utils'
import { getAllocableRange } from '@/lib/scheduling/allocable-range'
import { OperatingWindowsEditor } from '../../_components/operating-windows-editor'
import { TodosEditor } from '../../_components/todos-editor'

interface Props {
  tenantSlug: string
  tenantId: string
  eventId: string
  preselectedStage: Stage | null
  schedulingGranularityMin: number
}

interface FormErrors {
  name?: string
  windows?: Record<number, string>
}

export default function WorkstationForm({
  tenantSlug,
  tenantId,
  eventId,
  preselectedStage,
  schedulingGranularityMin,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()

  const stageId = preselectedStage?.id ?? '__all__'
  const stageDays = getStageDays(preselectedStage)
  const isMultiDay = stageDays.length > 1
  // Use the buffered allocable range (±1h around a race), not the stage's raw
  // start/end — otherwise a window couldn't be set to match what the
  // scheduling grid actually shows around a race.
  const allocableRange = preselectedStage ? getAllocableRange(preselectedStage) : null
  const stageStartHHMM = allocableRange?.start.slice(11, 16) ?? null
  const stageEndHHMM = allocableRange?.end.slice(11, 16) ?? null
  const lastDay = stageDays[stageDays.length - 1] ?? null

  // On a multi-day stage, a window limited to the first day is allowed to
  // start before the stage's own start time (e.g. staffing arrives ahead of
  // the stage officially beginning) — there's no earlier day to put that
  // time on instead. A single-day stage has no such earlier day either, so
  // the floor still applies there.
  const minStartFor = stageDays.length === 1 ? (stageStartHHMM ?? undefined) : undefined
  function maxEndFor(limitToDay: string | null) {
    if (stageDays.length === 1 || limitToDay === lastDay) return stageEndHHMM ?? undefined
    return undefined
  }
  // Only called for multi-day windows (see call sites below), so there is no
  // first-day-of-a-single-day-stage case to clamp against here.
  function clampToDay(win: TimeWindow, newDay: string): TimeWindow {
    const { start } = win
    let { end } = win
    if (newDay === lastDay && stageEndHHMM && end && end > stageEndHHMM) end = ''
    return { ...win, start, end, limitToDay: newDay }
  }

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capacity, setCapacity] = useState(1)
  const [windows, setWindows] = useState<TimeWindow[]>([{ start: '', end: '', limitToDay: null }])
  const [todos, setTodos] = useState<string[]>([''])
  const todoRefs = useRef<(HTMLInputElement | null)[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, startSave] = useTransition()

  function addWindow() {
    setWindows((prev) => [...prev, { start: '', end: '', limitToDay: null }])
  }

  function matchStageHours() {
    const generated = matchStageHoursWindows(stageDays, stageStartHHMM, stageEndHHMM)
    if (generated.length === 0) return
    setWindows(generated)
    setErrors((prev) => ({ ...prev, windows: undefined }))
  }

  function removeWindow(index: number) {
    setWindows((prev) => prev.filter((_, i) => i !== index))
  }

  function clearWindowError(index: number) {
    if (errors.windows?.[index]) {
      setErrors((prev) => ({
        ...prev,
        windows: { ...prev.windows, [index]: undefined as unknown as string },
      }))
    }
  }

  function updateWindow(index: number, field: 'start' | 'end', value: string) {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
    clearWindowError(index)
  }

  function toggleLimitToDay(index: number) {
    setWindows((prev) =>
      prev.map((win, j) =>
        j === index
          ? win.limitToDay !== null
            ? { ...win, limitToDay: null }
            : clampToDay(win, stageDays[0])
          : win
      )
    )
  }

  function setLimitDay(index: number, day: string) {
    setWindows((prev) => prev.map((win, j) => (j === index ? clampToDay(win, day) : win)))
    clearWindowError(index)
  }

  function addTodo() {
    setTodos((prev) => {
      const next = [...prev, '']
      setTimeout(() => todoRefs.current[next.length - 1]?.focus(), 0)
      return next
    })
  }

  function removeTodo(index: number) {
    setTodos((prev) => prev.filter((_, i) => i !== index))
  }

  function updateTodo(index: number, value: string) {
    setTodos((prev) => prev.map((t, i) => (i === index ? value : t)))
  }

  function validate(): boolean {
    const newErrors: FormErrors = {}
    if (!name.trim()) newErrors.name = t('workstations.nameRequired')
    const windowErrors: Record<number, string> = {}
    windows.forEach((w, i) => {
      if (!w.start && !w.end) return
      if (!w.start) {
        windowErrors[i] = t('workstations.windowStartRequired')
        return
      }
      if (!w.end) {
        windowErrors[i] = t('workstations.windowEndRequired')
        return
      }
      // A window limited to the stage's first day is allowed to start before
      // the stage's own start time on a multi-day stage (see minStartFor) —
      // the floor only applies on a single-day stage.
      const onFirstDay = stageDays.length === 1
      const onLastDay = stageDays.length === 1 || w.limitToDay === lastDay
      if (onFirstDay && stageStartHHMM && w.start < stageStartHHMM) {
        windowErrors[i] = t('workstations.windowBeforeStageStart', { time: stageStartHHMM })
      } else if (onLastDay && stageEndHHMM && w.end > stageEndHHMM) {
        windowErrors[i] = t('workstations.windowAfterStageEnd', { time: stageEndHHMM })
      } else if (windowDurationMin(w.start, w.end) < schedulingGranularityMin) {
        windowErrors[i] = t('workstations.windowTooShort', { minutes: schedulingGranularityMin })
      }
    })
    if (Object.keys(windowErrors).length > 0) newErrors.windows = windowErrors
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSave() {
    if (!validate()) return
    setSaveSuccess(false)

    startSave(async () => {
      const finalWindows = expandWindows(windows, stageDays, allocableRange?.start ?? null)

      const result = await createWorkstation({
        tenantSlug,
        tenantId,
        eventId,
        stageId: stageId === '__all__' ? null : stageId,
        name,
        description,
        capacity,
        recurring: isMultiDay && windows.some((w) => w.limitToDay === null),
        windows: finalWindows,
        todos: todos.filter((t) => t.trim()),
        schedulingGranularityMin,
      })

      if (result.error) {
        toastError(result.error)
      } else {
        setSaveSuccess(true)
        router.push(`/${tenantSlug}/admin/workstations`)
      }
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Button
            variant="light"
            size="sm"
            onPress={() => router.push(`/${tenantSlug}/admin/workstations`)}
            className="mb-1 px-0 text-default-400"
            startContent={<span>←</span>}
          >
            {t('workstations.backToList')}
          </Button>
          <h1 className="text-2xl font-semibold text-gray-900">{t('workstations.addTitle')}</h1>
        </div>
        <Button
          color={saveSuccess ? 'success' : 'primary'}
          variant={saveSuccess ? 'flat' : 'solid'}
          onPress={handleSave}
          isDisabled={isSaving}
          isLoading={isSaving}
        >
          {isSaving
            ? t('workstations.saving')
            : saveSuccess
              ? t('workstations.saved')
              : t('workstations.save')}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[3fr_2fr]">
        {/* Left column */}
        <div className="space-y-8">
          {/* Stage */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('workstations.stageLabel')}
            </h2>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-600">
              {preselectedStage
                ? `${preselectedStage.name} — ${preselectedStage.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')}`
                : t('workstations.allStages')}
            </div>
          </section>

          {/* Identity */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('workstations.identity')}
            </h2>
            <div className="space-y-4">
              <Input
                label={t('workstations.nameLabel')}
                value={name}
                onValueChange={(val) => {
                  setName(val)
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('workstations.namePlaceholder')}
                isInvalid={!!errors.name}
                errorMessage={errors.name}
              />
              <Textarea
                label={t('workstations.descriptionLabel')}
                value={description}
                onValueChange={setDescription}
                minRows={3}
              />
            </div>
          </section>

          <OperatingWindowsEditor
            windows={windows}
            errors={errors.windows}
            isMultiDay={isMultiDay}
            stageDays={stageDays}
            canMatchStageHours={
              !!preselectedStage &&
              !!stageStartHHMM &&
              !!stageEndHHMM &&
              windows.every((w) => !w.start && !w.end)
            }
            onUpdateWindow={updateWindow}
            onRemoveWindow={removeWindow}
            onAddWindow={addWindow}
            onToggleLimitToDay={toggleLimitToDay}
            onSetLimitDay={setLimitDay}
            onMatchStageHours={matchStageHours}
            minStartFor={minStartFor}
            maxEndFor={maxEndFor}
          />
        </div>

        {/* Right column */}
        <div className="space-y-8">
          {/* Capacity */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('workstations.colCapacity')}
            </h2>
            <Input
              type="number"
              label={t('workstations.capacityLabel')}
              value={String(capacity)}
              onValueChange={(val) => setCapacity(Math.max(1, parseInt(val) || 1))}
              min={1}
            />
          </section>

          <TodosEditor
            todos={todos}
            todoRefs={todoRefs}
            onAddTodo={addTodo}
            onRemoveTodo={removeTodo}
            onUpdateTodo={updateTodo}
          />
        </div>
      </div>
    </div>
  )
}
