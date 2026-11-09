import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import InfoSectionModal from './info-section-modal'
import { saveInfoSection } from '../info-section-actions'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../info-section-actions', () => ({ saveInfoSection: vi.fn() }))

vi.mock('@/lib/image/resize-image', () => ({
  resizeImage: vi.fn(async (file: File) => ({ file, resized: false })),
}))

// Plain inputs keyed by label, so the test reads like the screen.
vi.mock('@/components/ui/form-fields', () => {
  const Field = ({
    label,
    value,
    onValueChange,
    errorMessage,
    multiline,
  }: {
    label: string
    value?: string
    onValueChange?: (v: string) => void
    errorMessage?: string
    multiline?: boolean
  }) => (
    <label>
      {label}
      {multiline ? (
        <textarea value={value} onChange={(e) => onValueChange?.(e.target.value)} />
      ) : (
        <input value={value} onChange={(e) => onValueChange?.(e.target.value)} />
      )}
      {errorMessage ? <span>{errorMessage}</span> : null}
    </label>
  )
  return {
    Input: Field,
    Textarea: (p: Parameters<typeof Field>[0]) => <Field {...p} multiline />,
  }
})

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onPress }: { children?: ReactNode; onPress?: () => void }) => (
    <button type="button" onClick={() => onPress?.()}>
      {children}
    </button>
  ),
}))

vi.mock('@heroui/react', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  return {
    Modal: ({ children }: { children?: ReactNode }) => <div role="dialog">{children}</div>,
    ModalContent: ({ children }: { children: (close: () => void) => ReactNode }) =>
      children(() => {}),
    ModalHeader: passthrough,
    ModalBody: passthrough,
    ModalFooter: passthrough,
  }
})

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const EVENT_ID = '22222222-2222-2222-2222-222222222222'

function renderModal(onSaved = vi.fn()) {
  render(
    <InfoSectionModal
      tenantId={TENANT_ID}
      eventId={EVENT_ID}
      section={null}
      onSaved={onSaved}
      onClose={vi.fn()}
    />
  )
  return onSaved
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => vi.clearAllMocks())

describe('InfoSectionModal', () => {
  // info-section-modal-error: title only.
  it('shows the needs-content error and does not save a title-only section', async () => {
    renderModal()
    type('eventConfig.infoSectionTitle', 'Start kit pickup')
    fireEvent.click(screen.getByText('eventConfig.infoSectionSave'))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'actionErrors.infoSectionNeedsContent'
    )
    expect(saveInfoSection).not.toHaveBeenCalled()
  })

  it('requires a title', async () => {
    renderModal()
    type('eventConfig.infoSectionText', 'Behind the arena')
    fireEvent.click(screen.getByText('eventConfig.infoSectionSave'))

    expect(await screen.findByText('actionErrors.infoSectionTitleRequired')).toBeInTheDocument()
    expect(saveInfoSection).not.toHaveBeenCalled()
  })

  it('saves a link-only section and reports back', async () => {
    vi.mocked(saveInfoSection).mockResolvedValue({})
    const onSaved = renderModal()
    type('eventConfig.infoSectionTitle', 'Live video')
    type('eventConfig.infoSectionLinkUrl', 'https://video.example.com')
    type('eventConfig.infoSectionLinkText', 'Watch live')
    fireEvent.click(screen.getByText('eventConfig.infoSectionSave'))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const fd = vi.mocked(saveInfoSection).mock.calls[0][0]
    expect(fd.get('title')).toBe('Live video')
    expect(fd.get('linkUrl')).toBe('https://video.example.com')
    expect(fd.get('linkLabel')).toBe('Watch live')
    expect(fd.get('sectionId')).toBeNull()
  })

  it('shows a server error on the field it names', async () => {
    vi.mocked(saveInfoSection).mockResolvedValue({ error: 'Too big', field: 'image' })
    const onSaved = renderModal()
    type('eventConfig.infoSectionTitle', 'Parking')
    type('eventConfig.infoSectionText', 'North lot')
    fireEvent.click(screen.getByText('eventConfig.infoSectionSave'))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too big')
    expect(onSaved).not.toHaveBeenCalled()
  })
})
