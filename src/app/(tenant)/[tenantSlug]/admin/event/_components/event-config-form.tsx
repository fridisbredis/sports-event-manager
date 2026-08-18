'use client'

import { useState, useTransition, useRef, KeyboardEvent } from 'react'
import { Button, Chip, Card, CardBody } from '@heroui/react'
import { Input, Textarea } from '@/components/ui/form-fields'
import {
  saveEvent,
  uploadEventLogo,
  updateTenantColorPalette,
  type StageInput,
  type LabelInput,
  type SaveEventInput,
} from '../actions'
import { publishEvent } from '@/lib/actions/publish-event'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import StageList from './stage-list'
import { LogoUploadField } from './logo-upload-field'
import { ColorPalettePicker } from './color-palette-picker'
import { DatesAndGranularitySection } from './dates-and-granularity-section'
import { FacilitiesEditor } from './facilities-editor'
import { derivedDateRange } from '../_utils'
import type { TenantPaletteKey } from '@/lib/theme/tenant-colors'

interface Props {
  tenantSlug: string
  tenantId: string
  eventId: string
  initialName: string
  initialEventType: string
  initialDescription: string
  initialLocation: string
  initialLogoUrl: string
  initialColorPalette: string
  initialGranularity: number
  initialStages: StageInput[]
  initialFacilities: LabelInput[]
  isPublished: boolean
}

interface FormErrors {
  name?: string
  stages?: string
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
  initialColorPalette,
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
  const [colorPalette, setColorPalette] = useState(initialColorPalette)
  const [isSavingPalette, startPaletteSave] = useTransition()
  const [paletteError, setPaletteError] = useState<string | undefined>()
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
      toastError(result.error)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } else if (result.publicUrl) {
      setLogoUrl(result.publicUrl)
      setLogoError(false)
      setSaveSuccess(false)
      markDirty()
    }
  }

  function handleColorPaletteSelect(key: TenantPaletteKey) {
    if (key === colorPalette || isSavingPalette) return
    const previous = colorPalette
    setColorPalette(key)
    setPaletteError(undefined)
    startPaletteSave(async () => {
      const result = await updateTenantColorPalette(tenantSlug, tenantId, key)
      if (result.error) {
        setColorPalette(previous)
        setPaletteError(t('eventConfig.colorThemeError'))
        toastError(t('eventConfig.colorThemeError'))
      }
    })
  }

  function handleFacilityKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const label = facilityInput.trim()
    if (!label) return
    setFacilities((prev) => [...prev, { label, position: prev.length }])
    setFacilityInput('')
    setSaveSuccess(false)
    markDirty()
  }

  function removeFacility(index: number) {
    setFacilities((prev) => prev.filter((_, i) => i !== index))
    setSaveSuccess(false)
    markDirty()
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
    setSaveSuccess(false)
    markDirty()
    setErrors({})
    startSave(async () => {
      const result = await saveEvent(buildInput())
      if (result.error) {
        toastError(result.error)
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
    startPublish(async () => {
      const result = await publishEvent({ tenantSlug, tenantId, eventId })
      if (result.error) {
        toastError(result.error)
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
          <Chip color={isPublished ? 'success' : 'warning'} variant="flat" size="sm">
            {isPublished ? t('eventConfig.published') : t('eventConfig.draft')}
          </Chip>
        </div>
        <div className="flex items-center gap-3">
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

      {/* Two-column layout */}
      <div className="grid grid-cols-[2fr_3fr] gap-5">
        {/* Left: Identity */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
            {t('eventConfig.identity')}
          </h2>
          <Card>
            <CardBody className="p-6 space-y-4">
              <LogoUploadField
                logoUrl={logoUrl}
                logoError={logoError}
                isUploading={isUploading}
                uploadError={uploadError}
                fileInputRef={fileInputRef}
                onFileChange={handleLogoFileChange}
                onImageError={() => setLogoError(true)}
                onRemove={() => {
                  setLogoUrl('')
                  setLogoError(false)
                  setSaveSuccess(false)
                  markDirty()
                }}
              />

              <ColorPalettePicker
                colorPalette={colorPalette}
                isSavingPalette={isSavingPalette}
                paletteError={paletteError}
                onSelect={handleColorPaletteSelect}
              />

              <Input
                label={t('eventConfig.eventName')}
                isRequired
                value={name}
                onValueChange={(val) => {
                  setName(val)
                  setSaveSuccess(false)
                  markDirty()
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
                  setSaveSuccess(false)
                  markDirty()
                }}
                placeholder={t('eventConfig.typePlaceholder')}
              />

              <Textarea
                label={t('eventConfig.description')}
                value={description}
                onValueChange={(val) => {
                  setDescription(val)
                  setSaveSuccess(false)
                  markDirty()
                }}
                minRows={4}
                placeholder={t('eventConfig.descriptionPlaceholder')}
              />

              <DatesAndGranularitySection
                isPublished={isPublished}
                dateRangeLabel={derivedDateRange(stages)}
                granularity={granularity}
                onGranularityChange={(minutes) => {
                  setGranularity(minutes)
                  setSaveSuccess(false)
                  markDirty()
                }}
              />

              <FacilitiesEditor
                facilities={facilities}
                facilityInput={facilityInput}
                onFacilityInputChange={setFacilityInput}
                onKeyDown={handleFacilityKeyDown}
                onRemoveFacility={removeFacility}
              />
            </CardBody>
          </Card>
        </section>

        {/* Right: Schedule & Setup */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">
            {t('eventConfig.scheduleSetup')}
          </h2>
          <Card>
            <CardBody className="p-0">
              {/* Stages */}
              <StageList
                stages={stages}
                onChange={(updated) => {
                  setStages(updated)
                  setSaveSuccess(false)
                  markDirty()
                }}
              />
              {errors.stages && <p className="text-xs text-red-500 px-6 pb-4">{errors.stages}</p>}
            </CardBody>
          </Card>
        </section>
      </div>
    </div>
  )
}
