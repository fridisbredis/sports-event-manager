'use client'

import { useState, useTransition, useRef, useEffect, KeyboardEvent } from 'react'
import { Chip } from '@heroui/react'
import { AppCard } from '@/components/ui/app-card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/form-fields'
import {
  saveEvent,
  uploadEventLogo,
  removeEventLogo,
  updateTenantColorPalette,
  type StageInput,
  type LabelInput,
  type SaveEventInput,
} from '../actions'
import { publishEvent } from '@/lib/actions/publish-event'
import { useTranslation } from '@/lib/i18n/client'
import { useLanguage } from '@/components/i18n-provider'
import { resizeImage } from '@/lib/image/resize-image'
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
  canChooseColorTheme: boolean
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
  canChooseColorTheme,
  initialGranularity,
  initialStages,
  initialFacilities,
  isPublished,
}: Props) {
  const { t } = useTranslation('admin')
  const language = useLanguage()
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

  // The logo is staged, not written, until Save — the same contract as every
  // other field on this form. Two pieces of pending intent, deliberately
  // distinct from the displayed `logoUrl`:
  //
  //   pendingLogoFile    a chosen file not yet uploaded
  //   pendingLogoRemoval the admin pressed Remove on the stored logo
  //
  // Nothing reaches Storage or the events row until handleSave runs them, so
  // abandoning the page leaves the bucket and the row exactly as they were.
  // This is what keeps a forgotten Save from stranding a file in the bucket
  // with no row pointing at it — the failure mode that made the logo vanish
  // from INFO-01 in the first place.
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null)
  const [pendingLogoRemoval, setPendingLogoRemoval] = useState(false)

  // Revoked whenever it is replaced or cleared: an object URL pins its blob
  // in memory until the document goes away otherwise.
  const previewUrlRef = useRef<string | null>(null)
  function setPreview(url: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
  }
  useEffect(() => () => setPreview(null), [])

  // Re-seeded from the server payload for the same reason as the palette
  // below: useState keeps its mount-time value, so after a revalidate of this
  // route the form would keep showing — and sending back — whatever logo it
  // was built with.
  const [renderedLogoUrl, setRenderedLogoUrl] = useState(initialLogoUrl)
  if (renderedLogoUrl !== initialLogoUrl) {
    setRenderedLogoUrl(initialLogoUrl)
    // A staged pick or removal outranks the server value: it is the admin's
    // unsaved intent, and a revalidate triggered by something else on the
    // page must not silently discard it.
    if (!pendingLogoFile && !pendingLogoRemoval) {
      setLogoUrl(initialLogoUrl)
      setLogoError(false)
    }
  }
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
  // Fixed at 60 min in v1 — see DatesAndGranularitySection for why. Read from the
  // event row rather than hardcoded, so an older row keeps rendering its own value.
  const [granularity] = useState(initialGranularity)
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

    setUploadError(undefined)

    // Downscale on pick rather than on Save. The work is the same either way,
    // but doing it here means the preview shows the image that will actually
    // be uploaded, and Save stays a short operation.
    //
    // The logo renders at 72px, so a full-resolution file is bytes nobody
    // sees — and a Server Action body is capped at 1 MB, which a photo-sized
    // logo blows past before the action's own size check can report anything
    // useful. Shrinking first means a large source file just works instead of
    // being rejected for its size.
    const { file: resized } = await resizeImage(file, 'logo')

    const preview = URL.createObjectURL(resized)
    setPreview(preview)
    setPendingLogoFile(resized)
    // Picking a file supersedes a pending removal — the admin replaced the
    // logo rather than clearing it.
    setPendingLogoRemoval(false)
    setLogoUrl(preview)
    setLogoError(false)
    setSaveSuccess(false)
    markDirty()
  }

  // Staged like the file above: the row and the bucket are left alone until
  // Save. Choosing Remove and then leaving the page therefore keeps the logo,
  // which is why the leave-guard has to know about this.
  function handleLogoRemove() {
    setPreview(null)
    setPendingLogoFile(null)
    setPendingLogoRemoval(true)
    setLogoUrl('')
    setLogoError(false)
    setUploadError(undefined)
    setSaveSuccess(false)
    markDirty()
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Runs as the first step of Save, before the events row is written, so a
  // failed upload aborts the whole save rather than leaving the form claiming
  // success over a logo that never landed. Returns the URL to persist, or
  // `undefined` to leave the column as it is.
  async function commitPendingLogo(): Promise<
    { ok: true; logoUrl?: string | null } | { ok: false }
  > {
    if (pendingLogoFile) {
      setIsUploading(true)
      const formData = new FormData()
      formData.append('file', pendingLogoFile)
      formData.append('tenantId', tenantId)
      formData.append('eventId', eventId)
      formData.append('tenantSlug', tenantSlug)
      formData.append('oldLogoUrl', initialLogoUrl)

      const result = await uploadEventLogo(formData)
      setIsUploading(false)

      if (result.error || !result.publicUrl) {
        const message = result.error ?? t('eventConfig.logoUploadError')
        setUploadError(message)
        toastError(message)
        return { ok: false }
      }

      setPreview(null)
      setPendingLogoFile(null)
      setLogoUrl(result.publicUrl)
      return { ok: true, logoUrl: result.publicUrl }
    }

    if (pendingLogoRemoval) {
      const result = await removeEventLogo(tenantSlug, tenantId, eventId)
      if (result.error) {
        setUploadError(result.error)
        toastError(result.error)
        return { ok: false }
      }
      setPendingLogoRemoval(false)
      return { ok: true, logoUrl: null }
    }

    return { ok: true }
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

  // `logoUrl` is whatever is on screen, which during a pending change is a
  // blob: preview URL — never something to persist. The logo the save should
  // write is decided by commitPendingLogo and passed in here instead.
  function buildInput(resolvedLogoUrl: string | null | undefined): SaveEventInput {
    return {
      tenantSlug,
      tenantId,
      eventId,
      name,
      event_type: eventType,
      description,
      location,
      // undefined -> '' leaves the column alone (saveEvent skips an empty
      // value); a removal has already cleared it via removeEventLogo.
      logo_url: resolvedLogoUrl ?? '',
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
      // The logo first: it is the only part of this form that writes to
      // Storage, and a failure there must stop the save rather than report
      // success over a logo that never landed.
      const logo = await commitPendingLogo()
      if (!logo.ok) return

      const result = await saveEvent(buildInput(logo.logoUrl))
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
          {!isPublished && (
            // Secondary, and placed before Save: two solid primary buttons
            // side by side give the row no clear primary action, and the
            // primary one belongs last in the row.
            <Button
              variant="bordered"
              onPress={handlePublish}
              isDisabled={isSaving || isPublishing}
              isLoading={isPublishing}
              // HeroUI's `bordered` is transparent, so on the grey page ground
              // the button has no fill of its own — `bg-white` gives it one.
              className="rounded-control border-edge-field bg-white"
            >
              {isPublishing ? t('eventConfig.publishing') : t('eventConfig.publish')}
            </Button>
          )}
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
              isPending={pendingLogoFile !== null || pendingLogoRemoval}
              fileInputRef={fileInputRef}
              onFileChange={handleLogoFileChange}
              onImageError={() => setLogoError(true)}
              onRemove={handleLogoRemove}
            />

            <ColorPalettePicker
              colorPalette={colorPalette}
              isSavingPalette={isSaving}
              paletteError={paletteError}
              onSelect={handleColorPaletteSelect}
              isLocked={!canChooseColorTheme}
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
              dateRangeLabel={derivedDateRange(stages, language)}
              granularity={granularity}
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
            {/* px-4, matching the card's header and stage rows — this sits in
                the same p-0 card and was indented a step further than
                everything above it. No top margin: StageList's own hint fires
                on the same condition and already carries the gap below the
                rows when both are showing. */}
            {errors.stages && <p className="text-xs text-red-500 px-4 pb-4">{errors.stages}</p>}
          </AppCard>
        </section>
      </div>
    </div>
  )
}
