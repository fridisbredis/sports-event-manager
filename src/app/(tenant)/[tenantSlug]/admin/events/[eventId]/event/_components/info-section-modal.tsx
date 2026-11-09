'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { resizeImage } from '@/lib/image/resize-image'
import { type InfoSection, infoSectionImageUrl } from '@/lib/events/info-sections'
import { saveInfoSection, type InfoSectionField } from '../info-section-actions'
import { normalizeResultsUrl } from '../_utils'
import {
  INFO_SECTION_IMAGE_MAX_DIMENSION,
  INFO_SECTION_IMAGE_TYPES,
  INFO_SECTION_LIMITS,
} from '../_info-section-rules'

interface Props {
  tenantId: string
  eventId: string
  /** null = add a new section. */
  section: InfoSection | null
  onSaved: () => void
  onClose: () => void
}

type Errors = Partial<Record<InfoSectionField, string>>

// EVT-02 info-section-modal / info-section-modal-error. Saving here writes
// the section straight away (saveInfoSection) — it is not staged for the
// page's Save button. The checks below mirror the server's so the common
// mistakes are caught without a round trip; the server stays the boundary.
export default function InfoSectionModal({ tenantId, eventId, section, onSaved, onClose }: Props) {
  const { t } = useTranslation('admin')
  const { t: tc } = useTranslation('common')

  const [title, setTitle] = useState(section?.title ?? '')
  const [body, setBody] = useState(section?.body ?? '')
  const [linkUrl, setLinkUrl] = useState(section?.link_url ?? '')
  const [linkLabel, setLinkLabel] = useState(section?.link_label ?? '')
  const [newImage, setNewImage] = useState<File | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [isSaving, setIsSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview of a freshly picked file, derived from it; the object URL is
  // revoked when the file is replaced or the modal closes.
  const previewUrl = useMemo(() => (newImage ? URL.createObjectURL(newImage) : null), [newImage])
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const existingImage = section?.image_path && !removeImage ? section.image_path : null
  const shownImage = previewUrl ?? (existingImage ? infoSectionImageUrl(existingImage) : null)

  function clearError(field: InfoSectionField) {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev))
  }

  function validate(): Errors {
    const next: Errors = {}
    if (!title.trim()) next.title = tc('actionErrors.infoSectionTitleRequired')
    else if (title.trim().length > INFO_SECTION_LIMITS.title)
      next.title = tc('actionErrors.infoSectionTitleTooLong')
    if (body.trim().length > INFO_SECTION_LIMITS.body)
      next.content = tc('actionErrors.infoSectionBodyTooLong')
    const link = normalizeResultsUrl(linkUrl)
    if (!link.ok) next.link = tc('actionErrors.infoSectionLinkInvalid')
    // L23: at least one of text, image, link.
    if (!next.content && !body.trim() && !newImage && !existingImage && !(link.ok && link.value))
      next.content = tc('actionErrors.infoSectionNeedsContent')
    return next
  }

  async function handleSave() {
    const found = validate()
    if (Object.values(found).some(Boolean)) {
      setErrors(found)
      return
    }

    setIsSaving(true)
    try {
      const fd = new FormData()
      fd.set('tenantId', tenantId)
      fd.set('eventId', eventId)
      if (section) fd.set('sectionId', section.id)
      fd.set('title', title)
      fd.set('body', body)
      fd.set('linkUrl', linkUrl)
      fd.set('linkLabel', linkLabel)
      if (removeImage) fd.set('removeImage', '1')
      if (newImage) {
        const { file } = await resizeImage(newImage, 'image', INFO_SECTION_IMAGE_MAX_DIMENSION)
        fd.set('image', file)
      }

      const result = await saveInfoSection(fd)
      if (result.error) {
        setErrors({ [result.field ?? 'content']: result.error })
        return
      }
      onSaved()
    } catch {
      // A thrown action (network, a stale action id after a redeploy) must
      // not leave the modal stuck in its saving state.
      setErrors({ content: t('eventConfig.infoSectionSaveFailed') })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      isOpen
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose()
      }}
      size="md"
      scrollBehavior="inside"
      classNames={{ base: 'bg-gray-50' }}
    >
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="text-sm font-semibold">
              {section
                ? t('eventConfig.editInfoSectionTitle')
                : t('eventConfig.addInfoSectionTitle')}
            </ModalHeader>

            <ModalBody className="space-y-4">
              <Input
                label={t('eventConfig.infoSectionTitle')}
                isRequired
                value={title}
                maxLength={INFO_SECTION_LIMITS.title}
                onValueChange={(v) => {
                  setTitle(v)
                  clearError('title')
                }}
                placeholder={t('eventConfig.infoSectionTitlePlaceholder')}
                isInvalid={!!errors.title}
                errorMessage={errors.title}
              />

              <Textarea
                label={t('eventConfig.infoSectionText')}
                value={body}
                minRows={4}
                maxLength={INFO_SECTION_LIMITS.body}
                onValueChange={(v) => {
                  setBody(v)
                  clearError('content')
                }}
              />

              {/* Image: one per section. Picking a file only stages it; it is
                  downscaled and uploaded when the section is saved. */}
              <div>
                <p className="mb-1.5 block text-sm font-medium text-default-700">
                  {t('eventConfig.infoSectionImage')}
                </p>
                {shownImage ? (
                  // A blob: preview cannot go through next/image, and the
                  // saved image is shown at the same small size either way.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={shownImage}
                    alt={t('eventConfig.infoSectionImageAlt', { title: title || '…' })}
                    className="mb-2 max-h-40 w-full rounded-card-sm border border-edge object-contain bg-white"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="bordered"
                    onPress={() => fileInputRef.current?.click()}
                    className="rounded-control"
                  >
                    {shownImage
                      ? t('eventConfig.infoSectionImageReplace')
                      : t('eventConfig.infoSectionImageChoose')}
                  </Button>
                  {shownImage ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="light"
                      color="danger"
                      onPress={() => {
                        setNewImage(null)
                        if (section?.image_path) setRemoveImage(true)
                        if (fileInputRef.current) fileInputRef.current.value = ''
                      }}
                      className="font-medium text-destructive"
                    >
                      {t('eventConfig.infoSectionImageRemove')}
                    </Button>
                  ) : null}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={INFO_SECTION_IMAGE_TYPES.join(',')}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null
                    if (file) {
                      setNewImage(file)
                      setRemoveImage(false)
                      clearError('image')
                      clearError('content')
                    }
                  }}
                />
                <p className="mt-1.5 text-xs text-default-400">
                  {t('eventConfig.infoSectionImageHint')}
                </p>
                {errors.image ? (
                  <p role="alert" className="mt-1 text-xs text-danger">
                    {errors.image}
                  </p>
                ) : null}
              </div>

              <Input
                type="url"
                inputMode="url"
                label={t('eventConfig.infoSectionLinkUrl')}
                value={linkUrl}
                onValueChange={(v) => {
                  setLinkUrl(v)
                  clearError('link')
                  clearError('content')
                }}
                placeholder={t('eventConfig.infoSectionLinkUrlPlaceholder')}
                isInvalid={!!errors.link}
                errorMessage={errors.link}
              />

              <Input
                label={t('eventConfig.infoSectionLinkText')}
                value={linkLabel}
                maxLength={INFO_SECTION_LIMITS.linkLabel}
                onValueChange={setLinkLabel}
                placeholder={t('eventConfig.infoSectionLinkTextPlaceholder')}
                description={t('eventConfig.infoSectionLinkTextHint')}
              />

              {/* info-section-modal-error: the "needs content" rule belongs to
                  no single field, so it sits under all of them. */}
              {errors.content ? (
                <p
                  role="alert"
                  className="flex items-start gap-1.5 rounded-card-sm bg-danger-50 px-3 py-2 text-sm text-danger"
                >
                  <span aria-hidden="true" className="font-bold">
                    !
                  </span>
                  {errors.content}
                </p>
              ) : null}
            </ModalBody>

            <ModalFooter>
              <Button variant="light" onPress={onModalClose} isDisabled={isSaving}>
                {t('eventConfig.cancel')}
              </Button>
              <Button color="primary" onPress={handleSave} isLoading={isSaving}>
                {t('eventConfig.infoSectionSave')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
