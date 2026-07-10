'use client'

import { useState, useTransition, useRef } from 'react'
import { Button, Input, Textarea, Select, SelectItem, TimeInput } from '@heroui/react'
import { Time } from '@internationalized/date'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import ConfirmDialog from '@/components/confirm-dialog'
import { updateWorkstation, deleteWorkstation } from '../../actions'
import { type Stage, type TimeWindow, getStageDays, expandWindows } from '../../_utils'

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
}

// Windows are stored and compared as plain "HH:MM" wall-clock strings with no
// associated date or timezone, so TimeInput is given a plain `Time` value —
// never CalendarDateTime/ZonedDateTime — to avoid any browser-timezone conversion.
function hhmmToTime(hhmm: string): Time | undefined {
  if (!hhmm) return undefined
  const [h, m] = hhmm.split(':').map(Number)
  return new Time(h, m)
}

function timeToHHMM(time: Time | null): string {
  if (!time) return ''
  return `${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`
}

interface FormErrors {
  name?: string
  windows?: Record<number, string>
}

// Reconstruct per-window state from stored timestamps.
// For multi-day stages, a window that appears exactly once is treated as limited to that day.
// A window that appears on multiple days is recurring (limitToDay: null), deduplicated by HH:MM.
// For single-day stages, just strip to HH:MM.
function initWindowsFromStored(
  stored: { window_start: string; window_end: string }[],
  stageDays: string[]
): TimeWindow[] {
  if (stored.length === 0) return [{ start: '', end: '', limitToDay: null }]

  const sorted = [...stored].sort((a, b) => a.window_start.localeCompare(b.window_start))

  if (stageDays.length > 1) {
    // Count occurrences per HH:MM pair
    const counts = new Map<string, number>()
    for (const w of sorted) {
      const key = `${w.window_start.slice(11, 16)}|${w.window_end.slice(11, 16)}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    const seen = new Set<string>()
    const result: TimeWindow[] = []
    for (const w of sorted) {
      const start = w.window_start.slice(11, 16)
      const end = w.window_end.slice(11, 16)
      const key = `${start}|${end}`
      if (!seen.has(key)) {
        seen.add(key)
        const isLimited = (counts.get(key) ?? 0) === 1
        result.push({
          start,
          end,
          limitToDay: isLimited ? w.window_start.slice(0, 10) : null,
        })
      }
    }
    return result.length > 0 ? result : [{ start: '', end: '', limitToDay: null }]
  }

  return sorted.map((w) => ({
    start: w.window_start.slice(11, 16),
    end: w.window_end.slice(11, 16),
    limitToDay: null,
  }))
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

  function updateWindow(index: number, field: 'start' | 'end', value: string) {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
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

          {/* Operating windows */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('workstations.operatingWindowsLabel')}
            </h2>
            <div className="space-y-3">
              {windows.map((w, i) => (
                <div key={i} className={`rounded-lg border p-3 ${errors.windows?.[i] ? 'border-red-300' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <TimeInput
                      aria-label={t('workstations.windowStartLabel')}
                      value={hhmmToTime(w.start) ?? null}
                      minValue={hhmmToTime(minStartFor(w.limitToDay) ?? '')}
                      validationBehavior="aria"
                      isInvalid={!!errors.windows?.[i]}
                      onChange={(val) => {
                        updateWindow(i, 'start', timeToHHMM(val as Time | null))
                        if (errors.windows?.[i]) setErrors((prev) => ({ ...prev, windows: { ...prev.windows, [i]: undefined as unknown as string } }))
                      }}
                      hourCycle={24}
                      className="flex-1"
                    />
                    <span className="text-gray-400">–</span>
                    <TimeInput
                      aria-label={t('workstations.windowEndLabel')}
                      value={hhmmToTime(w.end) ?? null}
                      maxValue={hhmmToTime(maxEndFor(w.limitToDay) ?? '')}
                      validationBehavior="aria"
                      isInvalid={!!errors.windows?.[i]}
                      onChange={(val) => {
                        updateWindow(i, 'end', timeToHHMM(val as Time | null))
                        if (errors.windows?.[i]) setErrors((prev) => ({ ...prev, windows: { ...prev.windows, [i]: undefined as unknown as string } }))
                      }}
                      hourCycle={24}
                      className="flex-1"
                    />
                    <Button
                      variant="light"
                      size="sm"
                      onPress={() => removeWindow(i)}
                      className="text-default-400 whitespace-nowrap"
                    >
                      {t('workstations.removeWindow')}
                    </Button>
                  </div>
                  {errors.windows?.[i] && (
                    <p className="mt-1.5 text-xs text-red-500">{errors.windows[i]}</p>
                  )}
                  {isMultiDay && (
                    <div className="mt-2.5 space-y-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-600 select-none">
                        <Input
                          type="checkbox"
                          checked={w.limitToDay !== null}
                          onChange={() => {
                            setWindows((prev) =>
                              prev.map((win, j) =>
                                j === i
                                  ? win.limitToDay !== null
                                    ? { ...win, limitToDay: null }
                                    : clampToDay(win, stageDays[0])
                                  : win
                              )
                            )
                            markDirty()
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-gray-900"
                        />
                        {t('workstations.limitToOneDay')}
                      </label>
                      {w.limitToDay !== null && (
                        <Select
                          selectedKeys={[w.limitToDay]}
                          onSelectionChange={(keys) => {
                            const day = Array.from(keys)[0] as string
                            setWindows((prev) =>
                              prev.map((win, j) => (j === i ? clampToDay(win, day) : win))
                            )
                            if (errors.windows?.[i]) setErrors((prev) => ({ ...prev, windows: { ...prev.windows, [i]: undefined as unknown as string } }))
                            markDirty()
                          }}
                          aria-label={t('workstations.limitToOneDay')}
                        >
                          {stageDays.map((day) => (
                            <SelectItem key={day}>{day}</SelectItem>
                          ))}
                        </Select>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <Button
                variant="light"
                size="sm"
                onPress={addWindow}
                className="text-default-500 px-0"
              >
                {t('workstations.addWindow')}
              </Button>
            </div>
          </section>
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

          {/* Checklists / To-dos */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('workstations.todosLabel')}
            </h2>
            <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
              <div className="divide-y divide-gray-100">
                {todos.map((todo, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      disabled
                      className="h-4 w-4 rounded border-gray-300 text-gray-400 cursor-not-allowed opacity-50"
                    />
                    <Input
                      ref={(el) => { todoRefs.current[i] = el }}
                      type="text"
                      value={todo}
                      onChange={(e) => updateTodo(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTodo(); } }}
                      placeholder={t('workstations.todoPlaceholder')}
                      className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                    />
                    <Button
                      variant="light"
                      size="sm"
                      onPress={() => removeTodo(i)}
                      className="text-xs text-default-400 min-w-0 px-1"
                    >
                      {t('workstations.removeTodo')}
                    </Button>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2.5 border-t border-gray-100">
                <Button
                  variant="light"
                  size="sm"
                  onPress={addTodo}
                  className="text-default-500 px-0"
                >
                  {t('workstations.addTodo')}
                </Button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
