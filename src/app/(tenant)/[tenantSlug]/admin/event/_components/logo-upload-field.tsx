import type { ChangeEvent, RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  logoUrl: string
  logoError: boolean
  isUploading: boolean
  uploadError: string | undefined
  fileInputRef: RefObject<HTMLInputElement | null>
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void
  onImageError: () => void
  onRemove: () => void
}

export function LogoUploadField({
  logoUrl,
  logoError,
  isUploading,
  uploadError,
  fileInputRef,
  onFileChange,
  onImageError,
  onRemove,
}: Props) {
  const { t } = useTranslation('admin')

  return (
    <div className="flex items-start gap-4">
      <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[10px] border-[1.5px] border-dashed border-edge-field bg-surface">
        {logoUrl && !logoError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoUrl}
            alt={t('eventConfig.logoAlt')}
            className="w-full h-full object-cover"
            onError={onImageError}
          />
        ) : (
          <svg
            className="h-6 w-6 text-ink-label"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 16l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="8.5" cy="8.5" r="1.5" />
          </svg>
        )}
      </div>
      <div className="flex-1">
        <label
          htmlFor="logo-file-input"
          className="mb-2 block font-display text-sm font-bold text-ink"
        >
          {t('eventConfig.logoLabel')}
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={onFileChange}
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
            className="rounded-lg border-edge-field bg-white text-[13px] text-ink"
          >
            {isUploading
              ? t('eventConfig.logoUploading')
              : logoUrl
                ? t('eventConfig.logoChange')
                : t('eventConfig.logoChoose')}
          </Button>
          {logoUrl && !isUploading && (
            <Button variant="light" size="sm" onPress={onRemove} className="text-xs text-ink-label">
              {t('eventConfig.logoRemove')}
            </Button>
          )}
        </div>
        {uploadError && <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>}
      </div>
    </div>
  )
}
