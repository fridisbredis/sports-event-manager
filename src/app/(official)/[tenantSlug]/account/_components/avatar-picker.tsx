'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { Camera } from 'lucide-react'
import { AvatarImage } from '@/components/ui/avatar-image'
import { useTranslation } from '@/lib/i18n/client'
import { uploadAvatar } from '@/lib/actions/avatar'
import { resizeImage } from '@/lib/image/resize-image'
import { toastError } from '@/lib/toast'

interface Props {
  avatarUrl: string | null
  name: string
  tenantId: string
  i18nNamespace: 'official' | 'admin'
}

/**
 * ACCT-01 profile picture. The avatar itself is the control: clicking it opens
 * the file picker, and the picked file uploads immediately rather than waiting
 * for the form's Save button.
 *
 * Uploading on pick, not on Save, is deliberate — the file goes to Storage and
 * the row's avatar_url is written in one server action, so there is no partial
 * state for Save to reconcile, and the unsaved-changes guard stays about the
 * text fields it already tracks.
 */
export function AvatarPicker({
  avatarUrl: initialAvatarUrl,
  name,
  tenantId,
  i18nNamespace,
}: Props) {
  const { t } = useTranslation(i18nNamespace)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl)
  const [isUploading, setIsUploading] = useState(false)

  const initials =
    name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)
    try {
      // Downscale before upload. A phone photo is several MB, and a Server
      // Action body is capped at 1 MB — without this the request is rejected
      // by Next.js before it ever reaches the action's own size check, so the
      // user gets a generic failure instead of a useful message.
      const { file: upload } = await resizeImage(file, 'avatar')

      const formData = new FormData()
      formData.append('file', upload)
      formData.append('tenantId', tenantId)
      formData.append('namespace', i18nNamespace)

      const result = await uploadAvatar(formData)

      if (result.error || !result.publicUrl) {
        toastError(result.error ?? t('account.avatarUploadError'))
        return
      }

      setAvatarUrl(result.publicUrl)
    } catch {
      toastError(t('account.avatarUploadError'))
    } finally {
      setIsUploading(false)
      // Clear the input so picking the same file again still fires onChange.
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex justify-center">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="sr-only"
        id="avatar-file-input"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        aria-label={avatarUrl ? t('account.avatarChange') : t('account.avatarAdd')}
        className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-tenant-primary focus-visible:ring-offset-2 disabled:cursor-wait"
      >
        <AvatarImage
          src={avatarUrl}
          initials={initials}
          alt={name}
          className="h-20 w-20 bg-status-neutral-bg"
          initialsClassName="text-2xl font-semibold text-ink-soft"
        />
        {/* The camera badge is what makes the avatar read as a control rather
            than decoration — without it the click target is invisible. */}
        <span className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-tenant-primary text-white transition-transform group-hover:scale-105">
          <Camera className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
        </span>
        {isUploading && (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70 text-xs font-semibold text-ink-soft">
            {t('account.avatarUploading')}
          </span>
        )}
      </button>
    </div>
  )
}
