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
      <div className="w-20 h-20 shrink-0 rounded-lg border-2 border-dashed border-gray-200 flex items-center justify-center bg-gray-50 overflow-hidden">
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
            className="w-8 h-8 text-gray-300"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
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
          >
            {isUploading
              ? t('eventConfig.logoUploading')
              : logoUrl
                ? t('eventConfig.logoChange')
                : t('eventConfig.logoChoose')}
          </Button>
          {logoUrl && !isUploading && (
            <Button variant="light" size="sm" onPress={onRemove} className="text-xs text-gray-400">
              {t('eventConfig.logoRemove')}
            </Button>
          )}
        </div>
        {uploadError && <p className="mt-1.5 text-xs text-red-500">{uploadError}</p>}
      </div>
    </div>
  )
}
