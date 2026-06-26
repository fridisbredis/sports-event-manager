'use client'

import { useState, useTransition } from 'react'
import { saveEvent, type StageInput, type SaveEventInput } from '../actions'

interface Props {
  tenantSlug: string
  tenantId: string
  eventId: string
  initialName: string
  initialEventType: string
  initialDescription: string
  initialLocation: string
  initialLogoUrl: string
  initialStartDate: string
  initialEndDate: string
  initialGranularity: number
  initialStages: StageInput[]
  isPublished: boolean
}

interface FormErrors {
  name?: string
  start_date?: string
  end_date?: string
  stages?: string
  general?: string
}

export default function EventConfigForm({
  tenantSlug,
  tenantId,
  eventId,
  initialName,
  initialEventType,
  initialDescription,
  initialLocation,
  initialLogoUrl,
  initialStartDate,
  initialEndDate,
  initialGranularity,
  initialStages,
  isPublished,
}: Props) {
  const [name, setName] = useState(initialName)
  const [eventType, setEventType] = useState(initialEventType)
  const [description, setDescription] = useState(initialDescription)
  const [location, setLocation] = useState(initialLocation)
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [startDate, setStartDate] = useState(initialStartDate)
  const [endDate, setEndDate] = useState(initialEndDate)
  const [granularity, setGranularity] = useState(initialGranularity)
  const [stages, setStages] = useState<StageInput[]>(
    initialStages.length > 0
      ? initialStages
      : [{ name: '', stage_date: '', venue: '', position: 0 }]
  )

  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [isSaving, startSave] = useTransition()

  function buildInput(): SaveEventInput {
    return {
      tenantSlug,
      tenantId,
      eventId,
      name,
      event_type: eventType,
      description,
      location,
      logo_url: logoUrl,
      start_date: startDate,
      end_date: endDate,
      scheduling_granularity_min: granularity,
      stages,
    }
  }

  function validate(): FormErrors {
    const errs: FormErrors = {}
    if (endDate && startDate && endDate < startDate) {
      errs.end_date = 'End date must be on or after start date.'
    }
    return errs
  }

  function handleSave() {
    setSaveSuccess(false)
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setErrors({})
    startSave(async () => {
      const result = await saveEvent(buildInput())
      if (result.error) {
        setErrors({ general: result.error })
      } else {
        setSaveSuccess(true)
      }
    })
  }

  function addStage() {
    setStages((prev) => [
      ...prev,
      { name: '', stage_date: '', venue: '', position: prev.length },
    ])
  }

  function removeStage(index: number) {
    setStages((prev) => prev.filter((_, i) => i !== index))
  }

  function updateStage(index: number, field: keyof StageInput, value: string) {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)))
  }

  return (
    <div className="space-y-10">
      {/* Identity */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
          Identity
        </h2>
        <div className="grid grid-cols-2 gap-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Event name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setSaveSuccess(false)
              }}
              placeholder="e.g. Viadal 2026"
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                errors.name ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
              }`}
            />
            {errors.name && <p className="mt-1.5 text-xs text-red-500">{errors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Event type</label>
            <input
              type="text"
              value={eventType}
              onChange={(e) => {
                setEventType(e.target.value)
                setSaveSuccess(false)
              }}
              placeholder="e.g. Trail run, Triathlon, Swim meet"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Location</label>
            <input
              type="text"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                setSaveSuccess(false)
              }}
              placeholder="City or venue name"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Logo URL</label>
            <input
              type="url"
              value={logoUrl}
              onChange={(e) => {
                setLogoUrl(e.target.value)
                setSaveSuccess(false)
              }}
              placeholder="https://…"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => {
                setDescription(e.target.value)
                setSaveSuccess(false)
              }}
              rows={3}
              placeholder="Short description visible to officials and participants"
              className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
            />
          </div>
        </div>
      </section>

      {/* Dates */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
          Dates
        </h2>
        <div className="grid grid-cols-2 gap-5 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Start date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const val = e.target.value
                setStartDate(val)
                setSaveSuccess(false)
                setErrors((prev) => ({
                  ...prev,
                  end_date: endDate && val && endDate < val
                    ? 'End date must be on or after start date.'
                    : undefined,
                }))
              }}
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                errors.start_date ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
              }`}
            />
            {errors.start_date && (
              <p className="mt-1.5 text-xs text-red-500">{errors.start_date}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              End date <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                const val = e.target.value
                setEndDate(val)
                setSaveSuccess(false)
                setErrors((prev) => ({
                  ...prev,
                  end_date: startDate && val && val < startDate
                    ? 'End date must be on or after start date.'
                    : undefined,
                }))
              }}
              className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                errors.end_date ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
              }`}
            />
            {errors.end_date && <p className="mt-1.5 text-xs text-red-500">{errors.end_date}</p>}
          </div>
        </div>
      </section>

      {/* Stages */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              Stages / days <span className="text-red-400">*</span>
            </h2>
            {errors.stages && <p className="mt-1 text-xs text-red-500">{errors.stages}</p>}
          </div>
          <button
            type="button"
            onClick={addStage}
            className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md px-3 py-1.5 hover:border-gray-300 transition-colors"
          >
            + Add stage
          </button>
        </div>

        <div className="space-y-3">
          {stages.map((stage, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_9rem_1fr_1.5rem] gap-3 items-start rounded-lg border border-gray-100 bg-gray-50 p-4"
            >
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                <input
                  type="text"
                  value={stage.name}
                  onChange={(e) => updateStage(i, 'name', e.target.value)}
                  placeholder="e.g. Day 1"
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                <input
                  type="date"
                  value={stage.stage_date}
                  onChange={(e) => updateStage(i, 'stage_date', e.target.value)}
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Venue</label>
                <input
                  type="text"
                  value={stage.venue}
                  onChange={(e) => updateStage(i, 'venue', e.target.value)}
                  placeholder="Optional"
                  className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
              <div className="pt-6 flex justify-center">
                {stages.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStage(i)}
                    className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none"
                    aria-label="Remove stage"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Scheduling */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
          Scheduling
        </h2>
        <div className="max-w-xs">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Scheduling granularity
          </label>
          <div className="relative">
          <select
            value={granularity}
            onChange={(e) => {
              setGranularity(Number(e.target.value))
              setSaveSuccess(false)
            }}
            className="w-full appearance-none rounded-lg border border-gray-200 px-3.5 py-2.5 pr-9 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value={30}>30 minutes</option>
            <option value={60}>60 minutes (default)</option>
            <option value={90}>90 minutes</option>
            <option value={120}>120 minutes</option>
          </select>
          <svg
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            The timeslot length used throughout scheduling. Set this before scheduling begins.
          </p>
        </div>
      </section>

      {/*
       * TODO (migration 0005 applied — UI not yet built):
       * Add "Distances" section: list of free-text distance labels (e.g. "50 km", "100 km").
       * Table: event_distances (id, tenant_id, event_id, label, position).
       * Same add/remove pattern as stages.
       *
       * TODO (migration 0005 applied — UI not yet built):
       * Add "Facilities" section: list of free-text facility labels (e.g. "Showers", "Parking").
       * Table: event_facilities (id, tenant_id, event_id, label, position).
       * Both are MVP scope item 1 — must be built before first real-user release.
       */}

      {/* Action bar */}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-md bg-white border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-700 hover:border-gray-300 hover:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? 'Saving…' : isPublished ? 'Save changes' : 'Save draft'}
        </button>

        {saveSuccess && !isSaving && <span className="text-sm text-green-600">Saved.</span>}

        {errors.general && <span className="text-sm text-red-500">{errors.general}</span>}

        {/* Publish button is wired in step 5 */}
      </div>
    </div>
  )
}
