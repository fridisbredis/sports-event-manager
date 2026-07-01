'use client'

import { useState, useTransition } from 'react'
import { saveEvent, type StageInput, type LabelInput, type SaveEventInput } from '../actions'
import { publishEvent } from '@/lib/actions/publish-event'
import { useTranslation } from '@/lib/i18n/client'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import StageList from './stage-list'

interface Props {
  tenantSlug: string
  tenantId: string
  eventId: string
  initialName: string
  initialEventType: string
  initialDescription: string
  initialLocation: string
  initialLogoUrl: string
  initialGranularity: number
  initialStages: StageInput[]
  initialFacilities: LabelInput[]
  isPublished: boolean
}

interface FormErrors {
  name?: string
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
  initialGranularity,
  initialStages,
  initialFacilities,
  isPublished,
}: Props) {
  const { t } = useTranslation('admin')
  const { markDirty, markClean, dialogProps } = useUnsavedChanges()

  const [name, setName] = useState(initialName)
  const [eventType, setEventType] = useState(initialEventType)
  const [description, setDescription] = useState(initialDescription)
  const [location] = useState(initialLocation)
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [logoError, setLogoError] = useState(false)
  const [granularity, setGranularity] = useState(initialGranularity)
  const [stages, setStages] = useState<StageInput[]>(initialStages)
  const [facilitiesText, setFacilitiesText] = useState(
    initialFacilities.map((f) => f.label).join(', ')
  )

  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isPublishing, startPublish] = useTransition()

  function derivedDateRange(stageList: StageInput[]): string | null {
    // Slice the date portion directly from the datetime-local string ('YYYY-MM-DDTHH:mm')
    // to avoid Date constructor interpreting it as local time and shifting the date.
    const raceDates = stageList
      .filter((s) => s.stage_type === 'race' && s.start_time)
      .flatMap((s) => [s.start_time!.slice(0, 10), (s.end_time ?? s.start_time!).slice(0, 10)])
      .sort()
    if (!raceDates.length) return null
    const minDate = new Date(raceDates[0] + 'T00:00Z')
    const maxDate = new Date(raceDates[raceDates.length - 1] + 'T00:00Z')
    const sDay = minDate.getUTCDate()
    const eDay = maxDate.getUTCDate()
    const sMonth = minDate.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    const eMonth = maxDate.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })
    const year = maxDate.getUTCFullYear()
    if (sMonth === eMonth) return `${sDay}–${eDay} ${sMonth} ${year}`
    return `${sDay} ${sMonth} – ${eDay} ${eMonth} ${year}`
  }

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
      scheduling_granularity_min: granularity,
      stages,
      facilities: parseLabelText(facilitiesText),
    }
  }

  function handleSave() {
    if (!name.trim()) {
      setErrors({ name: t('eventConfig.eventNameEmpty') })
      return
    }
    setSaveSuccess(false); markDirty()
    setErrors({})
    startSave(async () => {
      const result = await saveEvent(buildInput())
      if (result.error) {
        setErrors({ general: result.error })
      } else {
        setSaveSuccess(true)
        markClean()
      }
    })
  }

  function handlePublish() {
    const errs: FormErrors = {}
    if (!name.trim()) errs.name = t('eventConfig.publishRequiresName')
    const hasRaceStage = stages.some((s) => s.stage_type === 'race')
    if (!hasRaceStage) errs.stages = t('eventConfig.noRaceStageWarning')
    if (errs.name || errs.stages) {
      setErrors(errs)
      return
    }
    setErrors((prev) => ({ ...prev, publish: undefined }))
    startPublish(async () => {
      const result = await publishEvent({ tenantSlug, tenantId, eventId })
      if (result.error) {
        setErrors((prev) => ({ ...prev, publish: result.error }))
      }
    })
  }

  return (
    <div>
      <UnsavedChangesDialog {...dialogProps} />
      {/* Page header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-gray-900">{t('eventConfig.title')}</h1>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isPublished
                ? 'bg-green-50 text-green-700 ring-1 ring-green-600/20'
                : 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/20'
            }`}
          >
            {isPublished ? t('eventConfig.published') : t('eventConfig.draft')}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {errors.general && <span className="text-sm text-red-500">{errors.general}</span>}
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
            {isSaving
              ? t('eventConfig.saving')
              : saveSuccess
                ? t('eventConfig.saved')
                : t('eventConfig.save')}
          </button>
          {!isPublished && (
            <button
              type="button"
              onClick={handlePublish}
              disabled={isSaving || isPublishing}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {isPublishing ? t('eventConfig.publishing') : t('eventConfig.publish')}
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
      <div className="grid grid-cols-[2fr_3fr] gap-10">
        {/* Left: Identity */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
            {t('eventConfig.identity')}
          </h2>
          <div className="space-y-4">
            {/* Logo */}
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
                {logoUrl && !logoError ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoUrl}
                    alt={t('eventConfig.logoAlt')}
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
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {t('eventConfig.logoUrl')}
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => { setLogoUrl(e.target.value); setLogoError(false); setSaveSuccess(false); markDirty() }}
                  placeholder={t('eventConfig.logoPlaceholder')}
                  className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('eventConfig.eventName')} <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSaveSuccess(false); markDirty()
                  if (e.target.value.trim()) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('eventConfig.eventNamePlaceholder')}
                className={`w-full rounded-lg border px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 ${
                  errors.name ? 'border-red-300 focus:ring-red-400/20' : 'border-gray-200'
                }`}
              />
              {errors.name && <p className="mt-1.5 text-xs text-red-500">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('eventConfig.type')}
              </label>
              <input
                type="text"
                value={eventType}
                onChange={(e) => {
                  setEventType(e.target.value)
                  setSaveSuccess(false); markDirty()
                }}
                placeholder={t('eventConfig.typePlaceholder')}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('eventConfig.description')}
              </label>
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setSaveSuccess(false); markDirty()
                }}
                rows={4}
                placeholder={t('eventConfig.descriptionPlaceholder')}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10 resize-none"
              />
            </div>

            {/* Dates / duration */}
            {isPublished ? (
              /* Published: dates + granularity side by side, then lock note */
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {t('eventConfig.datesDuration')}
                    </label>
                    <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
                      {derivedDateRange(stages) ?? '—'}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      {t('eventConfig.schedulingGranularity')}
                    </label>
                    <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
                      {granularity} min
                    </div>
                  </div>
                </div>
                <p className="text-xs text-gray-400 -mt-2">
                  {t('eventConfig.granularityLockedNote')}
                </p>
              </>
            ) : (
              /* Draft: dates full-width, then granularity narrow */
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('eventConfig.datesDuration')}
                  </label>
                  <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-500 select-none">
                    {derivedDateRange(stages) ?? '—'}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {t('eventConfig.schedulingGranularity')}
                  </label>
                  <div className="relative w-48">
                    <select
                      value={granularity}
                      onChange={(e) => {
                        setGranularity(Number(e.target.value))
                        setSaveSuccess(false); markDirty()
                      }}
                      className="w-full appearance-none rounded-lg border border-gray-200 px-3.5 py-2.5 pr-9 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
                    >
                      <option value={30}>{t('eventConfig.granularity30min')}</option>
                      <option value={60}>{t('eventConfig.granularity60min')}</option>
                      <option value={90}>{t('eventConfig.granularity90min')}</option>
                      <option value={120}>{t('eventConfig.granularity120min')}</option>
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
              </>
            )}

            {/* Facilities */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('eventConfig.facilities')}
              </label>
              <input
                type="text"
                value={facilitiesText}
                onChange={(e) => {
                  setFacilitiesText(e.target.value)
                  setSaveSuccess(false); markDirty()
                }}
                placeholder={t('eventConfig.facilitiesPlaceholder')}
                className="w-full rounded-lg border border-gray-200 px-3.5 py-2.5 text-sm text-gray-900 shadow-xs outline-none focus:ring-2 focus:ring-gray-900/10"
              />
            </div>
          </div>
        </section>

        {/* Right: Schedule & Setup */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
            {t('eventConfig.scheduleSetup')}
          </h2>
          <div className="space-y-4">
            {/* Stages */}
            <StageList
              stages={stages}
              onChange={(updated) => {
                setStages(updated)
                setSaveSuccess(false); markDirty()
              }}
            />
            {errors.stages && <p className="text-xs text-red-500">{errors.stages}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
