import { describe, it, expect, vi } from 'vitest'
import { createRef } from 'react'
import { render, screen } from '@testing-library/react'
import { LogoUploadField } from './logo-upload-field'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderField(overrides: Partial<Parameters<typeof LogoUploadField>[0]> = {}) {
  return render(
    <LogoUploadField
      logoUrl=""
      logoError={false}
      isUploading={false}
      uploadError={undefined}
      isPending={false}
      fileInputRef={createRef<HTMLInputElement>()}
      onFileChange={vi.fn()}
      onImageError={vi.fn()}
      onRemove={vi.fn()}
      {...overrides}
    />
  )
}

describe('LogoUploadField', () => {
  // The logo is applied on Save like every other field on this form. The
  // plate updates the moment a file is picked, which on its own reads as
  // already stored — so the pending state has to be stated in words.
  it('says the change is applied on save while one is staged', () => {
    renderField({ isPending: true, logoUrl: 'blob:preview' })

    expect(screen.getByText('eventConfig.logoPendingSave')).toBeInTheDocument()
  })

  it('says nothing about saving when there is no staged change', () => {
    renderField({ logoUrl: 'https://cdn.example.test/logo.webp' })

    expect(screen.queryByText('eventConfig.logoPendingSave')).not.toBeInTheDocument()
  })

  // An error is the more urgent message and replaces the pending note rather
  // than stacking two lines under the control.
  it('shows the error instead of the pending note when both apply', () => {
    renderField({ isPending: true, uploadError: 'Upload failed' })

    expect(screen.getByText('Upload failed')).toBeInTheDocument()
    expect(screen.queryByText('eventConfig.logoPendingSave')).not.toBeInTheDocument()
  })

  it('offers Remove only once there is a logo to remove', () => {
    const { unmount } = renderField()
    expect(screen.queryByText('eventConfig.logoRemove')).not.toBeInTheDocument()
    unmount()

    renderField({ logoUrl: 'https://cdn.example.test/logo.webp' })
    expect(screen.getByText('eventConfig.logoRemove')).toBeInTheDocument()
  })
})
