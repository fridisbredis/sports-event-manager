'use client'

import { useState, useTransition, useRef, KeyboardEvent } from 'react'
import { Chip } from '@heroui/react'
import { AppCard } from '@/components/ui/app-card'
import { Button } from '@/components/ui/button'
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
import { tenantThemeVars } from '@/lib/theme/tenant-theme-style'

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
  // Leaving with an unsaved palette has to put the theme back. Picking a colour
  // writes the CSS variables straight onto :root for an immediate preview, and
  // unlike every other field here that lives in component state, those survive
  // the navigation — the abandoned colour would follow the user to the next
  // page and read as saved.
  const { markDirty, markClean, dialogProps } = useUnsavedChanges({
    onDiscard: () => paintTheme(savedPalette),
  })

  const [name, setName] = useState(initialName)
  const [eventType, setEventType] = useState(initialEventType)
  const [description, setDescription] = useState(initialDescription)
  const location = initialLocation
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [logoError, setLogoError] = useState(false)
  const [colorPalette, setColorPalette] = useState(initialColorPalette)

  // The palette saves on click and the server then revalidates this route, so
  // a fresh `initialColorPalette` arrives as a prop on the next render. Without
  // this, `useState` keeps whatever it was seeded with at mount and the picker
  // drifts out of step with both the database and the theme the layout paints
  // — the selection appears to snap back to the previously stored colour.
  // Re-seeding during render (rather than in an effect) applies the new value
  // before the user ever sees a frame with the stale one.
  // What the database currently holds, as opposed to what is being previewed.
  // Save compares the two to decide whether the tenant row needs writing at
  // all, and a failed palette write rolls the preview back to this.
  const [savedPalette, setSavedPalette] = useState(initialColorPalette)

  // A fresh server payload (after a save, or any revalidate of this route)
  // re-seeds both: useState alone keeps its mount-time value forever, which
  // would leave the picker showing a palette the database no longer holds.
  const [renderedPalette, setRenderedPalette] = useState(initialColorPalette)
  if (renderedPalette !== initialColorPalette) {
    setRenderedPalette(initialColorPalette)
    setSavedPalette(initialColorPalette)
    setColorPalette(initialColorPalette)
  }
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

  // Repaint the theme straight onto :root. TenantThemeStyle is a server
  // component — it emits its <style> when the layout renders, so on its own the
  // colour could not change until the server re-rendered, which meant waiting
  // on a round trip to see the choice. Setting the variables here makes the
  // preview immediate; the server's own <style> takes over unchanged on the
  // next render, because it resolves to exactly these values.
  function paintTheme(key: string) {
    const root = document.documentElement
    for (const [name, value] of tenantThemeVars(key)) {
      root.style.setProperty(name, value)
    }
  }

  // Picking a palette only previews it. The choice is written when the form is
  // saved, like every other field here — so a palette tried on and abandoned
  // leaves nothing behind, and the unsaved-changes guard can warn about it.
  function handleColorPaletteSelect(key: TenantPaletteKey) {
    if (key === colorPalette) return
    setColorPalette(key)
    paintTheme(key)
    setPaletteError(undefined)
    setSaveSuccess(false)
    markDirty()
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
        return
      }

      // The palette lives on the tenant, not the event, so it is a separate
      // write — but it belongs to the same Save press. Only sent when it
      // actually changed, to keep an unrelated save off the tenants table.
      if (colorPalette !== savedPalette) {
        const paletteResult = await updateTenantColorPalette(
          tenantSlug,
          tenantId,
          colorPalette as TenantPaletteKey
        )
        if (paletteResult.error) {
          // The event saved; only the theme did not. Put the preview back to
          // what is actually stored so the page does not claim a colour the
          // database never took.
          setColorPalette(savedPalette)
          paintTheme(savedPalette)
          setPaletteError(t('eventConfig.colorThemeError'))
          toastError(t('eventConfig.colorThemeError'))
          return
        }
        setSavedPalette(colorPalette)
      }

      setSaveSuccess(true)
      markClean()
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
          <h1 className="page-title">{t('eventConfig.title')}</h1>
          <Chip
            variant="flat"
            size="sm"
            // Exact published/draft colours from the design handoff; HeroUI's
            // success/warning palettes are a different green and amber.
            className={
              isPublished
                ? 'bg-status-ok-bg text-status-ok-text'
                : 'bg-status-pending-bg text-status-pending-text'
            }
          >
            {isPublished ? t('eventConfig.published') : t('eventConfig.draft')}
          </Chip>
        </div>
        <div className="flex items-center gap-3">
          <Button
            onPress={handleSave}
            isDisabled={isSaving || isPublishing || isUploading}
            isLoading={isSaving}
            // Save is the page's primary action and reads as a solid themed
            // button; the transient "Saved" confirmation still turns green.
            color={saveSuccess && !isSaving ? 'success' : 'primary'}
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
            >
              {isPublishing ? t('eventConfig.publishing') : t('eventConfig.publish')}
            </Button>
          )}
        </div>
      </div>

      {/* Two-column layout.

          auto-fit + minmax rather than a fixed ratio: the columns hold their
          width and drop to a single column the moment both no longer fit,
          instead of squeezing progressively and wrapping content inside the
          cards on the way down.

          380px, not the prototype's 480px. The stage row's fixed parts (expand
          toggle, type badge, Edit/Delete) measure ~210px together, so 380px
          leaves the stage name ~170px before anything is forced to wrap — and
          the admin content area is the viewport less a 224px sidebar and 64px
          of padding, so a 480px floor would hold the layout at one column until
          ~1210px even though two fit comfortably well below that. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(380px,1fr))] items-start gap-7">
        {/* Left: Identity */}
        <section>
          <h2 className="section-label mb-5">{t('eventConfig.identity')}</h2>
          <AppCard className="card-accent-primary" bodyClassName="space-y-4 p-6">
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
              isSavingPalette={isSaving}
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
          </AppCard>
        </section>

        {/* Right: Schedule & Setup */}
        <section>
          <h2 className="section-label mb-5">{t('eventConfig.scheduleSetup')}</h2>
          <AppCard className="card-accent-primary" bodyClassName="p-0">
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
          </AppCard>
        </section>
      </div>
    </div>
  )
}
