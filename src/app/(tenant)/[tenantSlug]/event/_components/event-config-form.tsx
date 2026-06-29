'use client'

import { useState, useTransition } from 'react'
import { saveEvent, type StageInput, type LabelInput, type SaveEventInput } from '../actions'
import { publishEvent } from '@/lib/actions/publish-event'

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
  initialDistances: LabelInput[]
  initialFacilities: LabelInput[]
  initialCategoryType: 'distance' | 'time'
  isPublished: boolean
}

interface FormErrors {
  name?: string
  end_date?: string
  stages?: string
  general?: string
  publish?: string
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
  initialDistances,
  initialFacilities,
  initialCategoryType,
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
  const [distancesText, setDistancesText] = useState(
    initialDistances.map((d) => d.label).join(', ')
  )
  const [facilitiesText, setFacilitiesText] = useState(
    initialFacilities.map((f) => f.label).join(', ')
  )
  const [categoryType, setCategoryType] = useState<'distance' | 'time'>(initialCategoryType)
  const [showStagesEditor, setShowStagesEditor] = useState(false)
  const [logoError, setLogoError] = useState(false)

  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isPublishing, startPublish] = useTransition()

  function parseLabelText(text: string): LabelInput[] {
    return text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label, i) => ({ label, position: i }))
  }

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
      category_type: categoryType,
      stages,
      distances: parseLabelText(distancesText),
      facilities: parseLabelText(facilitiesText),
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

  function handlePublish() {
    setErrors((prev) => ({ ...prev, publish: undefined }))
    startPublish(async () => {
      const result = await publishEvent({ tenantSlug, tenantId, eventId })
      if (result.error) {
        setErrors((prev) => ({ ...prev, publish: result.error }))
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

  const currentStageCount = stages.filter((s) => s.name.trim()).length

  return (
    <div>
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">Event configuration</h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isPublished
                ? 'bg-green-50 text-green-700 ring-1 ring-green-600/20'
                : 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20'
            }`}
          >
            {isPublished ? 'Published' : 'Draft'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {errors.general && (
            <span className="text-sm text-red-500">{errors.general}</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isPublishing}
            className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
              saveSuccess && !isSaving
                ? 'border-green-200 bg-white text-green-600'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900'
            }`}
          >
            {isSaving ? 'Saving…' : saveSuccess ? 'Saved' : 'Save'}
          </button>
          {!isPublished && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isSaving || isPublishing}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPublishing ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {errors.publish && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errors.publish}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-2 gap-10">
        {/* Left: Identity */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
            Identity
          </h2>
          <div className="space-y-4">
            {/* Logo */}
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
                {logoUrl && !logoError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt="Event logo"
                    className="w-full h-full object-cover"
                    onError={() => setLogoError(true)}
                  />
                ) : (
                  <svg className="w-8 h-8 text-gray-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 16l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                  </svg>
                )}
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Logo URL</label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => { setLogoUrl(e.target.value); setLogoError(false); setSaveSuccess(false) }}
                  placeholder="https://…"
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Event name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setSaveSuccess(false) }}
                placeholder="e.g. Viadal 2026"
                className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                  errors.name ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
                }`}
              />
              {errors.name && <p className="mt-1.5 text-xs text-red-500">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Type</label>
              <input
                type="text"
                value={eventType}
                onChange={(e) => { setEventType(e.target.value); setSaveSuccess(false) }}
                placeholder="e.g. Multi-stage road race"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => { setDescription(e.target.value); setSaveSuccess(false) }}
                rows={4}
                placeholder="Short description visible to officials and participants"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
              />
            </div>
          </div>
        </section>

        {/* Right: Schedule & Setup */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
            Schedule &amp; Setup
          </h2>
          <div className="space-y-4">
            {/* Dates + Stages row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Dates / duration
                </label>
                <div className="space-y-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      const val = e.target.value
                      setStartDate(val)
                      setSaveSuccess(false)
                      setErrors((prev) => ({
                        ...prev,
                        end_date:
                          endDate && val && endDate < val
                            ? 'End date must be on or after start date.'
                            : undefined,
                      }))
                    }}
                    className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                  />
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      const val = e.target.value
                      setEndDate(val)
                      setSaveSuccess(false)
                      setErrors((prev) => ({
                        ...prev,
                        end_date:
                          startDate && val && val < startDate
                            ? 'End date must be on or after start date.'
                            : undefined,
                      }))
                    }}
                    className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                      errors.end_date ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
                    }`}
                  />
                </div>
                {errors.end_date && (
                  <p className="mt-1.5 text-xs text-red-500">{errors.end_date}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Stages / days
                </label>
                <button
                  type="button"
                  onClick={() => setShowStagesEditor((v) => !v)}
                  className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 hover:border-gray-300 transition-colors"
                >
                  <span className={currentStageCount === 0 ? 'text-gray-400' : ''}>
                    {currentStageCount === 0
                      ? 'No stages'
                      : `${currentStageCount} stage${currentStageCount !== 1 ? 's' : ''}`}
                  </span>
                  <svg
                    className={`h-4 w-4 text-gray-400 transition-transform ${showStagesEditor ? 'rotate-180' : ''}`}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Stages editor — expands inline within this column */}
            {showStagesEditor && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Stages / days <span className="text-red-400">*</span>
                  </span>
                  <button
                    type="button"
                    onClick={addStage}
                    className="text-xs font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-md px-3 py-1.5 bg-white hover:border-gray-300 transition-colors"
                  >
                    + Add stage
                  </button>
                </div>
                {errors.stages && <p className="text-xs text-red-500">{errors.stages}</p>}
                <div className="space-y-2">
                  {stages.map((stage, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_8rem_1fr_1.25rem] gap-2 items-start"
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
                          className="w-full rounded-md border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-gray-900/10"
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
              </div>
            )}

            {/* Venues */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Venues</label>
              <input
                type="text"
                value={location}
                onChange={(e) => { setLocation(e.target.value); setSaveSuccess(false) }}
                placeholder="Town Square, Lakeside Park, City Arena"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>

            {/* Distances + Scheduling granularity */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-medium text-gray-700">
                    {categoryType === 'distance' ? 'Distances' : 'Times'}
                  </label>
                  <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs">
                    {(['distance', 'time'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setCategoryType(t); setSaveSuccess(false) }}
                        className={`px-2.5 py-1 font-medium transition-colors ${
                          categoryType === t
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-500 hover:text-gray-900 bg-white'
                        }`}
                      >
                        {t === 'distance' ? 'Distance' : 'Time'}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  value={distancesText}
                  onChange={(e) => { setDistancesText(e.target.value); setSaveSuccess(false) }}
                  placeholder={categoryType === 'distance' ? '42 km, 88 km, 120 km' : '1h, 3h, 6h, 12h'}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Scheduling granularity
                </label>
                <div className="relative">
                  <select
                    value={granularity}
                    onChange={(e) => { setGranularity(Number(e.target.value)); setSaveSuccess(false) }}
                    className="w-full appearance-none rounded-lg border border-gray-200 px-3.5 py-2.5 pr-9 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                  >
                    <option value={30}>30 min</option>
                    <option value={60}>60 min (default)</option>
                    <option value={90}>90 min</option>
                    <option value={120}>120 min</option>
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
              </div>
            </div>

            {/* Facilities */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Facilities</label>
              <input
                type="text"
                value={facilitiesText}
                onChange={(e) => { setFacilitiesText(e.target.value); setSaveSuccess(false) }}
                placeholder="Parking, Officials lounge, First aid"
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
          </div>
        </section>
      </div>

    </div>
  )
}
