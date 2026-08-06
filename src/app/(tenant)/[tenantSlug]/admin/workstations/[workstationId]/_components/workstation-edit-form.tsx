'use client'

import { useState, useTransition, useRef } from 'react'
import { Button, Input, Textarea } from '@heroui/react'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import ConfirmDialog from '@/components/confirm-dialog'
import { updateWorkstation, deleteWorkstation } from '../../actions'
import {
  type Stage,
  type TimeWindow,
  getStageDays,
  expandWindows,
  windowDurationMin,
  initWindowsFromStored,
} from '../../_utils'
import { OperatingWindowsEditor } from './operating-windows-editor'
import { TodosEditor } from './todos-editor'

interface Props {
  tenantSlug: string
  tenantId: string
  workstationId: string
  stages: Stage[]
  initialStageId: string | null
  initialName: string
  initialDescription: string
  initialCapacity: number
  initialWindows: { window_start: string; window_end: string }[]
  initialTodos: string[]
  schedulingGranularityMin: number
}

interface FormErrors {
  name?: string
  windows?: Record<number, string>
}

export default function WorkstationEditForm({
  tenantSlug,
  tenantId,
  workstationId,
  stages,
  initialStageId,
  initialName,
  initialDescription,
  initialCapacity,
  initialWindows,
  initialTodos,
  schedulingGranularityMin,
}: Props) {
  const { t } = useTranslation('admin')
  const { markDirty, markClean, guardedNavigate, dialogProps } = useUnsavedChanges()

  const stageId = initialStageId ?? '__all__'
  const selectedStage = stages.find((s) => s.id === stageId) ?? null
  const stageDays = getStageDays(selectedStage)
  const isMultiDay = stageDays.length > 1
  const stageStartHHMM = selectedStage?.start_time?.slice(11, 16) ?? null
  const stageEndHHMM = selectedStage?.end_time?.slice(11, 16) ?? null
  const lastDay = stageDays[stageDays.length - 1] ?? null

  function minStartFor(limitToDay: string | null) {
    if (stageDays.length === 1 || limitToDay === stageDays[0]) return stageStartHHMM ?? undefined
    return undefined
  }
  function maxEndFor(limitToDay: string | null) {
    if (stageDays.length === 1 || limitToDay === lastDay) return stageEndHHMM ?? undefined
    return undefined
  }
  function clampToDay(win: TimeWindow, newDay: string): TimeWindow {
    let { start, end } = win
    if (newDay === stageDays[0] && stageStartHHMM && start && start < stageStartHHMM) start = ''
    if (newDay === lastDay && stageEndHHMM && end && end > stageEndHHMM) end = ''
    return { ...win, start, end, limitToDay: newDay }
  }

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [capacity, setCapacity] = useState(initialCapacity)
  const [windows, setWindows] = useState<TimeWindow[]>(() =>
    initWindowsFromStored(initialWindows, stageDays)
  )
  const [todos, setTodos] = useState<string[]>(initialTodos.length > 0 ? initialTodos : [''])
  const todoRefs = useRef<(HTMLInputElement | null)[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isDeleting, startDelete] = useTransition()

  function addWindow() {
    setWindows((prev) => [...prev, { start: '', end: '', limitToDay: null }])
    markDirty()
  }

  function removeWindow(index: number) {
    setWindows((prev) => prev.filter((_, i) => i !== index))
    markDirty()
  }

  function clearWindowError(index: number) {
    if (errors.windows?.[index]) {
      setErrors((prev) => ({ ...prev, windows: { ...prev.windows, [index]: undefined as unknown as string } }))
    }
  }

  function updateWindow(index: number, field: 'start' | 'end', value: string) {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
    clearWindowError(index)
    markDirty()
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
    markDirty()
  }

  function setLimitDay(index: number, day: string) {
    setWindows((prev) => prev.map((win, j) => (j === index ? clampToDay(win, day) : win)))
    clearWindowError(index)
    markDirty()
  }

  function addTodo() {
    setTodos((prev) => {
      const next = [...prev, '']
      setTimeout(() => todoRefs.current[next.length - 1]?.focus(), 0)
      return next
    })
    markDirty()
  }

  function removeTodo(index: number) {
    setTodos((prev) => prev.filter((_, i) => i !== index))
    markDirty()
  }

  function updateTodo(index: number, value: string) {
    setTodos((prev) => prev.map((item, i) => (i === index ? value : item)))
    markDirty()
  }

  function validate(): boolean {
    const newErrors: FormErrors = {}
    if (!name.trim()) newErrors.name = t('workstations.nameRequired')
    const windowErrors: Record<number, string> = {}
    windows.forEach((w, i) => {
      if (!w.start && !w.end) return
      if (!w.start) { windowErrors[i] = t('workstations.windowStartRequired'); return }
      if (!w.end) { windowErrors[i] = t('workstations.windowEndRequired'); return }
      const onFirstDay = stageDays.length === 1 || w.limitToDay === stageDays[0]
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
      const finalWindows = expandWindows(windows, stageDays, selectedStage?.start_time ?? null)

      const result = await updateWorkstation({
        tenantSlug,
        tenantId,
        workstationId,
        stageId: stageId === '__all__' ? null : stageId,
        name,
        description,
        capacity,
        recurring: isMultiDay && windows.some((w) => w.limitToDay === null),
        windows: finalWindows,
        todos: todos.filter((item) => item.trim()),
        schedulingGranularityMin,
      })

      if (result.error) {
        toastError(result.error)
      } else {
        setSaveSuccess(true)
        markClean()
      }
    })
  }

  function handleDelete() {
    setDeleteDialogOpen(true)
  }

  function confirmDelete() {
    setDeleteDialogOpen(false)
    startDelete(async () => {
      const result = await deleteWorkstation({ tenantSlug, tenantId, workstationId })
      if (result.error) {
        toastError(result.error)
      } else {
        markClean()
        guardedNavigate(`/${tenantSlug}/admin/workstations`)
      }
    })
  }

  const isBusy = isSaving || isDeleting

  return (
    <div>
      <UnsavedChangesDialog {...dialogProps} />
      <ConfirmDialog
        open={deleteDialogOpen}
        title={t('workstations.delete')}
        body={t('workstations.deleteConfirm')}
        cancelLabel={t('actions.cancel', { ns: 'common' })}
        confirmLabel={t('actions.delete', { ns: 'common' })}
        onCancel={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        destructive
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Button
            variant="light"
            size="sm"
            onPress={() => guardedNavigate(`/${tenantSlug}/admin/workstations`)}
            className="mb-1 px-0 text-default-400"
            startContent={<span>←</span>}
          >
            {t('workstations.backToList')}
          </Button>
          <h1 className="text-2xl font-semibold text-gray-900">{name || t('workstations.namePlaceholder')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Button
            color="danger"
            variant="light"
            onPress={handleDelete}
            isDisabled={isBusy}
          >
            {t('workstations.delete')}
          </Button>
          <Button
            color={saveSuccess ? 'success' : 'primary'}
            variant={saveSuccess ? 'flat' : 'solid'}
            onPress={handleSave}
            isDisabled={isBusy}
            isLoading={isSaving}
          >
            {isSaving ? t('workstations.saving') : saveSuccess ? t('workstations.saved') : t('workstations.save')}
          </Button>
        </div>
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
              {selectedStage
                ? `${selectedStage.name} — ${selectedStage.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')}`
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
                  markDirty()
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('workstations.namePlaceholder')}
                isInvalid={!!errors.name}
                errorMessage={errors.name}
              />
              <Textarea
                label={t('workstations.descriptionLabel')}
                value={description}
                onValueChange={(val) => { setDescription(val); markDirty() }}
                minRows={3}
              />
            </div>
          </section>

          <OperatingWindowsEditor
            windows={windows}
            errors={errors.windows}
            isMultiDay={isMultiDay}
            stageDays={stageDays}
            minStartFor={minStartFor}
            maxEndFor={maxEndFor}
            onUpdateWindow={updateWindow}
            onRemoveWindow={removeWindow}
            onAddWindow={addWindow}
            onToggleLimitToDay={toggleLimitToDay}
            onSetLimitDay={setLimitDay}
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
              onValueChange={(val) => { setCapacity(Math.max(1, parseInt(val) || 1)); markDirty() }}
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
