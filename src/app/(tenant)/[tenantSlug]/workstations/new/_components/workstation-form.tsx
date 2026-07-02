'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import DateTimePicker from '@/components/date-time-picker'
import { createWorkstation } from '../../actions'

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
  eventId: string
  stages: Stage[]
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

function getRaceDays(stages: Stage[], selectedStageId: string): string[] {
  const relevant = selectedStageId === '__all__'
    ? stages.filter((s) => s.start_time && s.end_time)
    : stages.filter((s) => s.id === selectedStageId && s.start_time && s.end_time)

  const daySet = new Set<string>()
  for (const s of relevant) {
    const cur = new Date(s.start_time!)
    cur.setHours(0, 0, 0, 0)
    const last = new Date(s.end_time!)
    last.setHours(0, 0, 0, 0)
    while (cur <= last) {
      daySet.add(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
  }
  return [...daySet].sort()
}

function expandRecurring(
  times: { start: string; end: string }[],
  days: string[]
): { window_start: string; window_end: string }[] {
  return days.flatMap((day) =>
    times
      .filter((t) => t.start && t.end)
      .map((t) => {
        const overnight = t.end <= t.start
        let endDay = day
        if (overnight) {
          const d = new Date(day + 'T12:00:00')
          d.setDate(d.getDate() + 1)
          endDay = d.toISOString().slice(0, 10)
        }
        return { window_start: `${day}T${t.start}`, window_end: `${endDay}T${t.end}` }
      })
  )
}

function formatRaceDay(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function WorkstationForm({ tenantSlug, tenantId, eventId, stages }: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()

  const [stageId, setStageId] = useState<string>('__all__')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [capacity, setCapacity] = useState(1)
  const [windows, setWindows] = useState<TimeWindow[]>([{ start: '', end: '' }])
  const [recurring, setRecurring] = useState(false)
  const [recurringTimes, setRecurringTimes] = useState<TimeWindow[]>([{ start: '', end: '' }])
  const [todos, setTodos] = useState<string[]>([''])
  const todoRefs = useRef<(HTMLInputElement | null)[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, startSave] = useTransition()

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

  const selectedStage = stages.find((s) => s.id === stageId)
  const isRaceStage = selectedStage?.stage_type === 'race'

  const windowBounds = isRaceStage ? {
    min: selectedStage?.start_time ? shiftTime(selectedStage.start_time, -60) : undefined,
    max: selectedStage?.end_time   ? shiftTime(selectedStage.end_time, 60)   : undefined,
  } : { min: undefined, max: undefined }

  const raceDays = getRaceDays(stages, stageId)

  function addWindow() {
    setWindows((prev: TimeWindow[]) => [...prev, { start: '', end: '' }])
  }

  function removeWindow(index: number) {
    setWindows((prev: TimeWindow[]) => prev.filter((_, i) => i !== index))
  }

  function updateWindow(index: number, field: 'start' | 'end', value: string) {
    setWindows((prev: TimeWindow[]) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
  }

  function addRecurringTime() {
    setRecurringTimes((prev) => [...prev, { start: '', end: '' }])
  }

  function removeRecurringTime(index: number) {
    setRecurringTimes((prev) => prev.filter((_, i) => i !== index))
  }

  function updateRecurringTime(index: number, field: 'start' | 'end', value: string) {
    setRecurringTimes((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)))
  }

  function toggleRecurring() {
    if (!recurring) {
      const seeded = windows
        .filter((w) => w.start && w.end)
        .map((w) => ({
          start: w.start.slice(11, 16),
          end: w.end.slice(11, 16),
        }))
      setRecurringTimes(seeded.length > 0 ? seeded : [{ start: '', end: '' }])
    }
    setRecurring((r) => !r)
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

    if (!name.trim()) {
      newErrors.name = t('workstations.nameRequired')
    }

    const windowErrors: Record<number, string> = {}
    if (!recurring) {
      windows.forEach((w, i) => {
        if (w.start && w.end && w.end <= w.start) {
          windowErrors[i] = t('workstations.windowEndError')
        }
      })
    }
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
      const finalWindows = recurring
        ? expandRecurring(recurringTimes, raceDays)
        : windows.filter((w) => w.start && w.end).map((w) => ({ window_start: w.start, window_end: w.end }))

      const result = await createWorkstation({
        tenantSlug,
        tenantId,
        eventId,
        stageId: stageId === '__all__' ? null : stageId,
        name,
        description,
        capacity,
        windows: finalWindows,
        todos: todos.filter((t) => t.trim()),
      })

      if (result.error) {
        setErrors({ general: result.error })
      } else {
        setSaveSuccess(true)
        router.push(`/${tenantSlug}/workstations`)
      }
    })
  }

  const inputClass = (hasError?: boolean) =>
    `w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
      hasError ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
    }`

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <button
            onClick={() => router.push(`/${tenantSlug}/workstations`)}
            className="mb-1 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span>←</span>
            <span>{t('workstations.backToList')}</span>
          </button>
          <h1 className="text-2xl font-semibold text-gray-900">{t('workstations.addTitle')}</h1>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            saveSuccess
              ? 'border border-green-200 bg-white text-green-600'
              : 'bg-gray-900 text-white hover:bg-gray-700'
          } disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {isSaving ? t('workstations.saving') : saveSuccess ? t('workstations.saved') : t('workstations.save')}
        </button>
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
                const stage = stages.find((s) => s.id === newId)
                if (stage?.stage_type === 'race' && stage.start_time && stage.end_time) {
                  setWindows([{ start: shiftTime(stage.start_time, -60), end: shiftTime(stage.end_time, 60) }])
                } else {
                  setWindows([{ start: '', end: '' }])
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
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={inputClass()}
                />
              </div>
            </div>
          </section>

          {/* Operating windows */}
          <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {t('workstations.operatingWindowsLabel')}
                </h2>
                <label className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer select-none">
                  <span title={raceDays.length === 0 ? t('workstations.noDatesForRecurrence') : undefined}>
                    {t('workstations.repeatDaily')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={recurring}
                    disabled={raceDays.length === 0}
                    onClick={toggleRecurring}
                    className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none
                      ${recurring ? 'bg-gray-900' : 'bg-gray-200'}
                      disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                      ${recurring ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                  </button>
                </label>
              </div>
              {recurring ? (
                <div className="space-y-3">
                  {recurringTimes.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex gap-2">
                          <input
                            type="time"
                            value={w.start}
                            onChange={(e) => updateRecurringTime(i, 'start', e.target.value)}
                            className={`flex-1 rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${errors.windows?.[i] ? 'border-red-300' : 'border-gray-200'}`}
                          />
                          <input
                            type="time"
                            value={w.end}
                            onChange={(e) => updateRecurringTime(i, 'end', e.target.value)}
                            className={`flex-1 rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${errors.windows?.[i] ? 'border-red-300' : 'border-gray-200'}`}
                          />
                        </div>
                        {errors.windows?.[i] && (
                          <p className="text-xs text-red-500">{errors.windows[i]}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeRecurringTime(i)}
                        className="mt-2.5 text-sm text-gray-400 hover:text-gray-600 transition-colors whitespace-nowrap"
                      >
                        {t('workstations.removeWindow')}
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addRecurringTime}
                    className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
                  >
                    {t('workstations.addWindow')}
                  </button>
                  {raceDays.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2">
                      {t('workstations.repeatsAcross', {
                        count: raceDays.length,
                        days: raceDays.map(formatRaceDay).join(', '),
                      })}
                    </p>
                  )}
                </div>
              ) : (
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
                          />
                          <DateTimePicker
                            value={w.end}
                            min={windowBounds.min}
                            max={windowBounds.max}
                            onChange={(v) => updateWindow(i, 'end', v)}
                            hasError={!!(errors.windows?.[i])}
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
              )}
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
                onChange={(e) => setCapacity(Math.max(1, parseInt(e.target.value) || 1))}
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
