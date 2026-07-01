'use client'

import { useState, useTransition } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import DateTimePicker from '@/components/date-time-picker'
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
  initialWindows: { window_start: string; window_end: string }[]
  initialTodos: string[]
}

interface TimeWindow {
  start: string
  end: string
}

interface FormErrors {
  name?: string
  windows?: Record<number, string>
  general?: string
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

  const [stageId, setStageId] = useState<string>(initialStageId ?? '__all__')
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription)
  const [capacity, setCapacity] = useState(initialCapacity)
  const [windows, setWindows] = useState<TimeWindow[]>(
    initialWindows.length > 0
      ? initialWindows.map((w) => ({
          start: w.window_start.slice(0, 16),
          end: w.window_end.slice(0, 16),
        }))
      : [{ start: '', end: '' }]
  )
  const [todos, setTodos] = useState<string[]>(initialTodos.length > 0 ? initialTodos : [''])
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isDeleting, startDelete] = useTransition()

  function shiftTime(s: string, mins: number): string {
    const d = new Date(s.slice(0, 16).replace('T', ' '))
    d.setMinutes(d.getMinutes() + mins)
    const y  = d.getFullYear()
    const mo = String(d.getMonth() + 1).padStart(2, '0')
    const dy = String(d.getDate()).padStart(2, '0')
    const h  = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${y}-${mo}-${dy}T${h}:${mi}`
  }

  const windowBounds = (() => {
    if (stageId === '__all__') {
      const starts = stages.map((s) => s.start_time).filter(Boolean) as string[]
      const ends   = stages.map((s) => s.end_time).filter(Boolean) as string[]
      return {
        min: starts.length ? shiftTime(starts.slice().sort()[0], -60) : undefined,
        max: ends.length   ? shiftTime(ends.slice().sort().at(-1)!, 60) : undefined,
      }
    }
    const stage = stages.find((s) => s.id === stageId)
    return {
      min: stage?.start_time ? shiftTime(stage.start_time, -60) : undefined,
      max: stage?.end_time   ? shiftTime(stage.end_time, 60)   : undefined,
    }
  })()

  function addWindow() {
    setWindows((prev: TimeWindow[]) => [...prev, { start: '', end: '' }])
    markDirty()
  }

  function removeWindow(index: number) {
    setWindows((prev: TimeWindow[]) => prev.filter((_, i) => i !== index))
    markDirty()
  }

  function updateWindow(index: number, field: 'start' | 'end', value: string) {
    setWindows((prev: TimeWindow[]) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
    markDirty()
  }

  function addTodo() {
    setTodos((prev) => [...prev, ''])
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

    if (!name.trim()) {
      newErrors.name = t('workstations.nameRequired')
    }

    const windowErrors: Record<number, string> = {}
    windows.forEach((w, i) => {
      if (w.start && w.end && w.end <= w.start) {
        windowErrors[i] = t('workstations.windowEndError')
      }
    })
    if (Object.keys(windowErrors).length > 0) {
      newErrors.windows = windowErrors
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  function handleSave() {
    if (!validate()) return
    setSaveSuccess(false)

    startSave(async () => {
      const result = await updateWorkstation({
        tenantSlug,
        tenantId,
        workstationId,
        stageId: stageId === '__all__' ? null : stageId,
        name,
        description,
        capacity,
        windows: windows
          .filter((w) => w.start && w.end)
          .map((w) => ({ window_start: w.start, window_end: w.end })),
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
    if (!confirm(t('workstations.deleteConfirm'))) return

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
            <select
              value={stageId}
              onChange={(e) => {
                const newId = e.target.value
                setStageId(newId)
                markDirty()
                const stage = stages.find((s) => s.id === newId)
                if (stage?.stage_type === 'race' && stage.start_time && stage.end_time) {
                  setWindows([{ start: shiftTime(stage.start_time, -60), end: shiftTime(stage.end_time, 60) }])
                }
              }}
              className={inputClass()}
            >
              <option value="__all__">{t('workstations.allStages')}</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')}
                </option>
              ))}
            </select>
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
                <div key={i} className="flex items-start gap-2">
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex gap-2">
                      <DateTimePicker
                        value={w.start}
                        min={windowBounds.min}
                        max={windowBounds.max}
                        onChange={(v) => updateWindow(i, 'start', v)}
                        hasError={!!(errors.windows?.[i])}
                        disabled={stageId === '__all__'}
                      />
                      <DateTimePicker
                        value={w.end}
                        min={windowBounds.min}
                        max={windowBounds.max}
                        onChange={(v) => updateWindow(i, 'end', v)}
                        hasError={!!(errors.windows?.[i])}
                        disabled={stageId === '__all__'}
                      />
                    </div>
                    {errors.windows?.[i] && (
                      <p className="text-xs text-red-500">{errors.windows[i]}</p>
                    )}
                  </div>
                  <button
                    onClick={() => removeWindow(i)}
                    className="mt-2.5 text-sm text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
                  >
                    {t('workstations.removeWindow')}
                  </button>
                </div>
              ))}
              <button
                onClick={addWindow}
                className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
              >
                {t('workstations.addWindow')}
              </button>
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
                      type="text"
                      value={todo}
                      onChange={(e) => updateTodo(i, e.target.value)}
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
