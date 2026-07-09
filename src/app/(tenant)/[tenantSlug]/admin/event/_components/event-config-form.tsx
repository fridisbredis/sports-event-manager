'use client'

import { useState, useTransition, useRef, KeyboardEvent } from 'react'
import { Button, Input, Textarea, Select, SelectItem, Chip } from '@heroui/react'
import { saveEvent, uploadEventLogo, type StageInput, type LabelInput, type SaveEventInput } from '../actions'
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
  const location = initialLocation
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [logoError, setLogoError] = useState(false)
  const [granularity, setGranularity] = useState(initialGranularity)
  const [stages, setStages] = useState<StageInput[]>(initialStages)
  const [facilities, setFacilities] = useState<LabelInput[]>(initialFacilities)
  const [facilityInput, setFacilityInput] = useState('')

  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  async function handleLogoFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setUploadError(t('eventConfig.logoInvalidType'))
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setUploadError(t('eventConfig.logoTooLarge'))
      return
    }

    setUploadError(undefined)
    setIsUploading(true)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('tenantId', tenantId)
    formData.append('eventId', eventId)
    formData.append('oldLogoUrl', logoUrl)

    const result = await uploadEventLogo(formData)
    setIsUploading(false)

    if (result.error) {
      setUploadError(result.error)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } else if (result.publicUrl) {
      setLogoUrl(result.publicUrl)
      setLogoError(false)
      setSaveSuccess(false)
      markDirty()
    }
  }

  function handleFacilityKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const label = facilityInput.trim()
    if (!label) return
    setFacilities((prev) => [...prev, { label, position: prev.length }])
    setFacilityInput('')
    setSaveSuccess(false); markDirty()
  }

  function removeFacility(index: number) {
    setFacilities((prev) => prev.filter((_, i) => i !== index))
    setSaveSuccess(false); markDirty()
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
      facilities: facilities.map((f, i) => ({ label: f.label, position: i })),
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
          <Chip
            color={isPublished ? 'success' : 'warning'}
            variant="flat"
            size="sm"
          >
            {isPublished ? t('eventConfig.published') : t('eventConfig.draft')}
          </Chip>
        </div>
        <div className="flex items-center gap-3">
          {errors.general && <span className="text-sm text-red-500">{errors.general}</span>}
          <Button
            variant="bordered"
            onPress={handleSave}
            isDisabled={isSaving || isPublishing || isUploading}
            isLoading={isSaving}
            color={saveSuccess && !isSaving ? 'success' : 'default'}
            size="sm"
          >
            {isSaving
              ? t('eventConfig.saving')
              : saveSuccess
                ? t('eventConfig.saved')
                : t('eventConfig.save')}
          </Button>
          {!isPublished && (
            <Button
              color="primary"
              onPress={handlePublish}
              isDisabled={isSaving || isPublishing}
              isLoading={isPublishing}
              size="sm"
            >
              {isPublishing ? t('eventConfig.publishing') : t('eventConfig.publish')}
            </Button>
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
                  {t('eventConfig.logoLabel')}
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleLogoFileChange}
                  className="sr-only"
                  id="logo-file-input"
                />
                <div className="flex items-center gap-2">
                  <Button
                    variant="bordered"
                    size="sm"
                    isDisabled={isUploading}
                    isLoading={isUploading}
                    onPress={() => fileInputRef.current?.click()}
                  >
                    {isUploading
                      ? t('eventConfig.logoUploading')
                      : logoUrl
                        ? t('eventConfig.logoChange')
                        : t('eventConfig.logoChoose')}
                  </Button>
                  {logoUrl && !isUploading && (
                    <Button
                      variant="light"
                      size="sm"
                      onPress={() => { setLogoUrl(''); setLogoError(false); setSaveSuccess(false); markDirty() }}
                      className="text-xs text-gray-400"
                    >
                      {t('eventConfig.logoRemove')}
                    </Button>
                  )}
                </div>
                {uploadError && (
                  <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>
                )}
              </div>
            </div>

            <Input
              label={t('eventConfig.eventName')}
              isRequired
              value={name}
              onValueChange={(val) => {
                setName(val)
                setSaveSuccess(false); markDirty()
                if (val.trim()) setErrors((prev) => ({ ...prev, name: undefined }))
              }}
              placeholder={t('eventConfig.eventNamePlaceholder')}
              isInvalid={!!errors.name}
              errorMessage={errors.name}
            />

            <Input
              label={t('eventConfig.type')}
              value={eventType}
              onValueChange={(val) => {
                setEventType(val)
                setSaveSuccess(false); markDirty()
              }}
              placeholder={t('eventConfig.typePlaceholder')}
            />

            <Textarea
              label={t('eventConfig.description')}
              value={description}
              onValueChange={(val) => {
                setDescription(val)
                setSaveSuccess(false); markDirty()
              }}
              minRows={4}
              placeholder={t('eventConfig.descriptionPlaceholder')}
            />

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
                <div className="w-48">
                  <Select
                    label={t('eventConfig.schedulingGranularity')}
                    selectedKeys={[granularity.toString()]}
                    onSelectionChange={(keys) => {
                      setGranularity(Number(Array.from(keys)[0]))
                      setSaveSuccess(false); markDirty()
                    }}
                  >
                    <SelectItem key="30">{t('eventConfig.granularity30min')}</SelectItem>
                    <SelectItem key="60">{t('eventConfig.granularity60min')}</SelectItem>
                    <SelectItem key="90">{t('eventConfig.granularity90min')}</SelectItem>
                    <SelectItem key="120">{t('eventConfig.granularity120min')}</SelectItem>
                  </Select>
                </div>
              </>
            )}

            {/* Facilities */}
            <div>
              <Input
                label={t('eventConfig.facilities')}
                value={facilityInput}
                onValueChange={setFacilityInput}
                onKeyDown={handleFacilityKeyDown}
                placeholder={t('eventConfig.facilitiesPlaceholder')}
              />
              {facilities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {facilities.map((f, i) => (
                    <Chip
                      key={i}
                      onClose={() => removeFacility(i)}
                      variant="flat"
                    >
                      {f.label}
                    </Chip>
                  ))}
                </div>
              )}
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
