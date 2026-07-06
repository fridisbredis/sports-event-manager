'use client'

import { useState, useTransition, useRef } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import ConfirmDialog from '@/components/confirm-dialog'
import { updateWorkstation, deleteWorkstation } from '../../actions'

interface Stage {
  id: string
  name: string
  stage_type: string
  start_time: string | null
  end_time: string | null
}

interface Props {
  tenantSlug: string
  tenantId: string
  workstationId: string
  stages: Stage[]
  initialStageId: string | null
  initialName: string
  initialDescription: string
  initialCapacity: number
  initialRecurring: boolean
  initialWindows: { window_start: string; window_end: string }[]
  initialTodos: string[]
}

interface TimeWindow {
  start: string
  end: string
  recurring: boolean
}

interface FormErrors {
  name?: string
  general?: string
}

function getStageDays(stage: Stage | null): string[] {
  if (!stage?.start_time || !stage?.end_time) return []
  const daySet = new Set<string>()
  const cur = new Date(stage.start_time)
  cur.setUTCHours(0, 0, 0, 0)
  const last = new Date(stage.end_time)
  last.setUTCHours(0, 0, 0, 0)
  while (cur <= last) {
    daySet.add(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }
  return [...daySet].sort()
}

function expandWindows(
  windows: TimeWindow[],
  stageDays: string[]
): { window_start: string; window_end: string }[] {
  return windows
    .filter((w) => w.start && w.end)
    .flatMap((w) => {
      const days = w.recurring ? stageDays : stageDays.length > 0 ? [stageDays[0]] : []
      return days.map((day) => {
        const overnight = w.end <= w.start
        let endDay = day
        if (overnight) {
          const d = new Date(day + 'T12:00:00Z')
          d.setUTCDate(d.getUTCDate() + 1)
          endDay = d.toISOString().slice(0, 10)
        }
        return { window_start: `${day}T${w.start}`, window_end: `${endDay}T${w.end}` }
      })
    })
}

// Reconstruct per-window state from stored timestamps.
// Recurring windows were expanded (same HH:MM across multiple days), so
// deduplicate by time pair and mark recurring=true.
// Non-recurring windows are single entries; just strip to HH:MM.
function initWindowsFromStored(
  stored: { window_start: string; window_end: string }[],
  wasRecurring: boolean,
  stageDays: string[]
): TimeWindow[] {
  if (stored.length === 0) return [{ start: '', end: '', recurring: false }]

  const sorted = [...stored].sort((a, b) => a.window_start.localeCompare(b.window_start))

  if (wasRecurring && stageDays.length > 1) {
    // Deduplicate by HH:MM pair — each recurring time appears once per stage day
    const seen = new Set<string>()
    const result: TimeWindow[] = []
    for (const w of sorted) {
      const start = w.window_start.slice(11, 16)
      const end = w.window_end.slice(11, 16)
      const key = `${start}|${end}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({ start, end, recurring: true })
      }
    }
    return result.length > 0 ? result : [{ start: '', end: '', recurring: false }]
  }

  return sorted.map((w) => ({
    start: w.window_start.slice(11, 16),
    end: w.window_end.slice(11, 16),
    recurring: false,
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
  initialRecurring,
  initialWindows,
  initialTodos,
}: Props) {
  const { t } = useTranslation('admin')
  const { markDirty, markClean, guardedNavigate, dialogProps } = useUnsavedChanges()

  const stageId = initialStageId ?? '__all__'
  const selectedStage = stages.find((s) => s.id === stageId) ?? null
  const stageDays = getStageDays(selectedStage)
  const isMultiDay = stageDays.length > 1

  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [capacity, setCapacity] = useState(initialCapacity)
  const [windows, setWindows] = useState<TimeWindow[]>(() =>
    initWindowsFromStored(initialWindows, initialRecurring, stageDays)
  )
  const [todos, setTodos] = useState<string[]>(initialTodos.length > 0 ? initialTodos : [''])
  const todoRefs = useRef<(HTMLInputElement | null)[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isDeleting, startDelete] = useTransition()

  function addWindow() {
    setWindows((prev) => [...prev, { start: '', end: '', recurring: false }])
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

  function toggleWindowRecurring(index: number) {
    setWindows((prev) => prev.map((w, i) => (i === index ? { ...w, recurring: !w.recurring } : w)))
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
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSave() {
    if (!validate()) return
    setSaveSuccess(false)

    startSave(async () => {
      const finalWindows = expandWindows(windows, stageDays)
      const anyRecurring = windows.some((w) => w.recurring)

      const result = await updateWorkstation({
        tenantSlug,
        tenantId,
        workstationId,
        stageId: stageId === '__all__' ? null : stageId,
        name,
        description,
        capacity,
        recurring: anyRecurring,
        windows: finalWindows,
        todos: todos.filter((item) => item.trim()),
      })

      if (result.error) {
        setErrors({ general: result.error })
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
        setErrors({ general: result.error })
      } else {
        markClean()
        guardedNavigate(`/${tenantSlug}/workstations`)
      }
    })
  }

  const inputClass = (hasError?: boolean) =>
    `w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
      hasError ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
    }`

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
          <button
            onClick={() => guardedNavigate(`/${tenantSlug}/workstations`)}
            className="mb-1 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span>←</span>
            <span>{t('workstations.backToList')}</span>
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">{name || t('workstations.namePlaceholder')}</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleDelete}
            disabled={isBusy}
            className="rounded-lg border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('workstations.delete')}
          </button>
          <button
            onClick={handleSave}
            disabled={isBusy}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              saveSuccess
                ? 'border border-green-200 bg-white text-green-600'
                : 'bg-gray-900 text-white hover:bg-gray-700'
            } disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {isSaving ? t('workstations.saving') : saveSuccess ? t('workstations.saved') : t('workstations.save')}
          </button>
        </div>
      </div>

      {errors.general && (
        <p className="mb-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{errors.general}</p>
      )}

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
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t('workstations.nameLabel')}
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    markDirty()
                    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                  }}
                  placeholder={t('workstations.namePlaceholder')}
                  className={inputClass(!!errors.name)}
                />
                {errors.name && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.name}</p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  {t('workstations.descriptionLabel')}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => { setDescription(e.target.value); markDirty() }}
                  rows={3}
                  className={inputClass()}
                />
              </div>
            </div>
          </section>

          {/* Operating windows */}
          <section>
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('workstations.operatingWindowsLabel')}
            </h2>
            <div className="space-y-3">
              {windows.map((w, i) => (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={w.start}
                      onChange={(e) => updateWindow(i, 'start', e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                    <span className="text-gray-400">–</span>
                    <input
                      type="time"
                      value={w.end}
                      onChange={(e) => updateWindow(i, 'end', e.target.value)}
                      className="flex-1 rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                    />
                    <button
                      onClick={() => removeWindow(i)}
                      className="text-sm text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
                    >
                      {t('workstations.removeWindow')}
                    </button>
                  </div>
                  <label
                    className={`mt-2.5 flex items-center gap-2 text-sm select-none ${
                      isMultiDay ? 'cursor-pointer text-gray-600' : 'cursor-not-allowed text-gray-400'
                    }`}
                    title={!isMultiDay ? t('workstations.recurrentDailyDisabledHint') : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={w.recurring}
                      disabled={!isMultiDay}
                      onChange={() => toggleWindowRecurring(i)}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 disabled:cursor-not-allowed"
                    />
                    {t('workstations.recurrentDaily')}
                  </label>
                </div>
              ))}
              <button
                onClick={addWindow}
                className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
              >
                {t('workstations.addWindow')}
              </button>
              {isMultiDay && windows.some((w) => w.recurring) && (
                <p className="text-xs text-gray-400">
                  {t('workstations.recurrentDailyHint')}
                </p>
              )}
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
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                {t('workstations.capacityLabel')}
              </label>
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => { setCapacity(Math.max(1, parseInt(e.target.value) || 1)); markDirty() }}
                className={inputClass()}
              />
            </div>
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
                    <input
                      ref={(el) => { todoRefs.current[i] = el }}
                      type="text"
                      value={todo}
                      onChange={(e) => updateTodo(i, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTodo(); } }}
                      placeholder={t('workstations.todoPlaceholder')}
                      className="flex-1 bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
                    />
                    <button
                      onClick={() => removeTodo(i)}
                      className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {t('workstations.removeTodo')}
                    </button>
                  </div>
                ))}
              </div>
              <div className="px-3 py-2.5 border-t border-gray-100">
                <button
                  onClick={addTodo}
                  className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                >
                  {t('workstations.addTodo')}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
