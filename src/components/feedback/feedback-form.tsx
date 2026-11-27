'use client'

import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ImagePlus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { toastError, toastSuccess } from '@/lib/toast'
import {
  FEEDBACK_BODY_MAX,
  FEEDBACK_IMAGE_MAX_BYTES,
  FEEDBACK_IMAGE_TYPES,
  FEEDBACK_TITLE_MAX,
  type FeedbackSurface,
} from '@/lib/feedback/feedback'
import { FEEDBACK_TYPES, type FeedbackType } from '@/types/app'
import { FEEDBACK_TYPE_ICON } from './feedback-meta'

interface Props {
  tenantId: string
  /** The event the user is working in, when the surface has one. */
  eventId?: string | null
  surface: FeedbackSurface
  /**
   * The page the user came from (the nav link passes it as ?from=). Recorded
   * so a bug report says where it happened; falls back to this page's path.
   */
  fromPath?: string | null
}

/**
 * N71: send a question, bug report or feature request, with one optional
 * image. Posts multipart to /api/feedback (not a Server Action: the image may
 * be 5 MB, past the Server Action body limit). The limits are the route's own
 * constants, checked here first so a too-large image is refused before it is
 * uploaded rather than after.
 *
 * After a send: a toast, the form clears, and router.refresh() re-renders the
 * page's server-side "my feedback" list so the new row shows up with its
 * status.
 */
export function FeedbackForm({ tenantId, eventId, surface, fromPath }: Props) {
  const { t } = useTranslation('common')
  const router = useRouter()
  const idBase = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [type, setType] = useState<FeedbackType | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  // The file and its preview URL travel together, so they can never disagree.
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [sending, setSending] = useState(false)

  // Release each preview URL once it is replaced, removed or the form
  // unmounts. Cleanup only — the URL is created where the file is picked.
  useEffect(() => {
    if (!picked) return
    return () => URL.revokeObjectURL(picked.url)
  }, [picked])

  const image = picked?.file ?? null
  const preview = picked?.url ?? null
  function setImage(file: File | null) {
    setPicked(file ? { file, url: URL.createObjectURL(file) } : null)
  }

  const titleMissing = title.trim() === ''
  const bodyMissing = body.trim() === ''

  function onPickImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    // Clear the input so picking the same file again after removing it still
    // fires a change event.
    e.target.value = ''
    if (!file) return
    if (!(FEEDBACK_IMAGE_TYPES as readonly string[]).includes(file.type)) {
      setImageError(t('feedback.form.imageWrongType'))
      return
    }
    if (file.size > FEEDBACK_IMAGE_MAX_BYTES) {
      setImageError(t('feedback.form.imageTooLarge'))
      return
    }
    setImageError(null)
    setImage(file)
  }

  function reset() {
    setType(null)
    setTitle('')
    setBody('')
    setImage(null)
    setImageError(null)
    setShowErrors(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!type || titleMissing || bodyMissing) {
      setShowErrors(true)
      return
    }

    const form = new FormData()
    form.append('tenantId', tenantId)
    if (eventId) form.append('eventId', eventId)
    form.append('surface', surface)
    form.append('type', type)
    form.append('title', title.trim())
    form.append('body', body.trim())
    form.append('pagePath', fromPath?.startsWith('/') ? fromPath : window.location.pathname)
    if (image) form.append('image', image)

    setSending(true)
    try {
      const res = await fetch('/api/feedback', { method: 'POST', body: form })
      if (!res.ok) {
        const code = ((await res.json().catch(() => null)) as { code?: string } | null)?.code
        toastError(
          res.status === 429
            ? t('feedback.form.errorRate')
            : res.status === 413 || code === 'size'
              ? t('feedback.form.imageTooLarge')
              : code === 'type'
                ? t('feedback.form.imageWrongType')
                : t('feedback.form.errorGeneric')
        )
        return
      }
      toastSuccess(t('feedback.form.sent'))
      reset()
      router.refresh()
    } catch {
      toastError(t('feedback.form.errorGeneric'))
    } finally {
      setSending(false)
    }
  }

  const typeGroupId = `${idBase}-type`

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <fieldset aria-describedby={showErrors && !type ? `${typeGroupId}-error` : undefined}>
        <legend className="mb-3 font-display text-sm font-bold text-ink">
          {t('feedback.form.typeLabel')}
        </legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {FEEDBACK_TYPES.map((value) => {
            const Icon = FEEDBACK_TYPE_ICON[value]
            const checked = type === value
            return (
              <label
                key={value}
                className={`flex cursor-pointer items-start gap-3 rounded-control border bg-white p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-tenant-primary ${
                  checked
                    ? 'border-tenant-primary bg-tenant-primary-tint'
                    : 'border-edge-field hover:border-ink-faint'
                }`}
              >
                <input
                  type="radio"
                  name={typeGroupId}
                  value={value}
                  checked={checked}
                  onChange={() => setType(value)}
                  className="sr-only"
                />
                <Icon
                  aria-hidden
                  className={`mt-0.5 size-5 shrink-0 ${
                    checked ? 'text-tenant-primary-tint-text' : 'text-ink-soft'
                  }`}
                  strokeWidth={1.75}
                />
                <span>
                  <span className="block text-[15px] font-semibold text-ink">
                    {t(`feedback.type.${value}`)}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-label">
                    {t(`feedback.typeHint.${value}`)}
                  </span>
                </span>
              </label>
            )
          })}
        </div>
        {showErrors && !type && (
          <p id={`${typeGroupId}-error`} className="mt-2 text-xs text-red-500">
            {t('feedback.form.typeRequired')}
          </p>
        )}
      </fieldset>

      <Input
        label={t('feedback.form.titleLabel')}
        labelPlacement="outside"
        placeholder={t('feedback.form.titlePlaceholder')}
        value={title}
        onValueChange={setTitle}
        maxLength={FEEDBACK_TITLE_MAX}
        isRequired
        isInvalid={showErrors && titleMissing}
        errorMessage={t('feedback.form.titleRequired')}
      />

      <Textarea
        label={t('feedback.form.bodyLabel')}
        labelPlacement="outside"
        placeholder={t(
          type ? `feedback.form.bodyPlaceholder.${type}` : 'feedback.form.bodyPlaceholder.default'
        )}
        value={body}
        onValueChange={setBody}
        maxLength={FEEDBACK_BODY_MAX}
        minRows={5}
        isRequired
        isInvalid={showErrors && bodyMissing}
        errorMessage={t('feedback.form.bodyRequired')}
        description={`${body.length} / ${FEEDBACK_BODY_MAX}`}
      />

      <div>
        <p className="mb-2 font-display text-sm font-bold text-ink">
          {t('feedback.form.imageLabel')}{' '}
          <span className="font-normal text-ink-label">{t('feedback.form.optional')}</span>
        </p>
        <input
          ref={fileInputRef}
          id={`${idBase}-image`}
          type="file"
          accept={FEEDBACK_IMAGE_TYPES.join(',')}
          onChange={onPickImage}
          className="sr-only"
        />
        {preview ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, nothing for next/image to optimise */}
            <img
              src={preview}
              alt={t('feedback.form.imagePreviewAlt')}
              className="max-h-48 rounded-control border border-edge-field object-contain"
            />
            <button
              type="button"
              onClick={() => setImage(null)}
              aria-label={t('feedback.form.imageRemove')}
              className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border border-edge-field bg-white text-ink-soft shadow-sm hover:text-ink"
            >
              <X className="size-4" strokeWidth={2} />
            </button>
          </div>
        ) : (
          <Button
            variant="bordered"
            size="sm"
            onPress={() => fileInputRef.current?.click()}
            startContent={<ImagePlus className="size-4" strokeWidth={1.75} />}
          >
            {t('feedback.form.imageChoose')}
          </Button>
        )}
        <p className="mt-1.5 text-xs text-ink-label">{t('feedback.form.imageHint')}</p>
        {imageError && <p className="mt-1.5 text-xs text-red-500">{imageError}</p>}
      </div>

      <div className="flex justify-end">
        <Button type="submit" color="primary" isLoading={sending} isDisabled={sending}>
          {t('feedback.form.submit')}
        </Button>
      </div>
    </form>
  )
}
