import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { FeedbackForm } from './feedback-form'
import { toastError, toastSuccess } from '@/lib/toast'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/lib/toast', () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

const TENANT_ID = '7f3c1a52-2b8e-4d4a-9c61-0e5b8f2a9d10'
const EVENT_ID = '2b8e4d4a-9c61-4e5b-8f2a-9d107f3c1a52'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm() {
  return render(
    <FeedbackForm
      tenantId={TENANT_ID}
      eventId={EVENT_ID}
      surface="admin"
      fromPath="/club/admin/x"
    />
  )
}

function fillValid() {
  fireEvent.click(screen.getByLabelText(/feedback\.type\.bug/))
  fireEvent.change(screen.getByLabelText(/feedback\.form\.titleLabel/), {
    target: { value: '  The map is grey  ' },
  })
  fireEvent.change(screen.getByLabelText(/feedback\.form\.bodyLabel/), {
    target: { value: 'It never loads.' },
  })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'feedback.form.submit' }))
}

function fileInput() {
  return document.querySelector('input[type="file"]') as HTMLInputElement
}

describe('FeedbackForm', () => {
  it('shows what is missing and sends nothing when the form is empty', () => {
    renderForm()

    submit()

    expect(screen.getByText('feedback.form.typeRequired')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the trimmed fields with tenant, event, surface and origin page', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }))
    renderForm()

    fillValid()
    submit()

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('feedback.form.sent'))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/feedback')
    const body = init.body as FormData
    expect(body.get('tenantId')).toBe(TENANT_ID)
    expect(body.get('eventId')).toBe(EVENT_ID)
    expect(body.get('surface')).toBe('admin')
    expect(body.get('type')).toBe('bug')
    expect(body.get('title')).toBe('The map is grey')
    expect(body.get('pagePath')).toBe('/club/admin/x')
    expect(body.get('image')).toBeNull()
    expect(refresh).toHaveBeenCalled()
  })

  it('refuses an image over 5 MB before anything is uploaded', () => {
    renderForm()
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    })

    fireEvent.change(fileInput(), { target: { files: [big] } })

    expect(screen.getByText('feedback.form.imageTooLarge')).toBeInTheDocument()
    expect(screen.queryByAltText('feedback.form.imagePreviewAlt')).not.toBeInTheDocument()
  })

  it('refuses an image of an unsupported type', () => {
    renderForm()
    const gif = new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' })

    fireEvent.change(fileInput(), { target: { files: [gif] } })

    expect(screen.getByText('feedback.form.imageWrongType')).toBeInTheDocument()
  })

  it('previews a picked image, sends it along, and lets it be removed', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }))
    renderForm()
    const png = new File([new Uint8Array(10)], 'shot.png', { type: 'image/png' })

    fireEvent.change(fileInput(), { target: { files: [png] } })
    // Read as a data: URL, so the preview appears asynchronously.
    expect(await screen.findByAltText('feedback.form.imagePreviewAlt')).toHaveAttribute(
      'src',
      expect.stringMatching(/^data:image\/png;base64,/)
    )

    fireEvent.click(screen.getByRole('button', { name: 'feedback.form.imageRemove' }))
    expect(screen.queryByAltText('feedback.form.imagePreviewAlt')).not.toBeInTheDocument()

    fireEvent.change(fileInput(), { target: { files: [png] } })
    await screen.findByAltText('feedback.form.imagePreviewAlt')
    fillValid()
    submit()

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect((fetchMock.mock.calls[0][1].body as FormData).get('image')).toBeInstanceOf(File)
  })

  it('says to wait when the server rate-limits, and keeps what was written', async () => {
    fetchMock.mockResolvedValue(new Response('{"code":"rate"}', { status: 429 }))
    renderForm()

    fillValid()
    submit()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('feedback.form.errorRate'))
    expect(screen.getByLabelText(/feedback\.form\.titleLabel/)).toHaveValue('  The map is grey  ')
    expect(refresh).not.toHaveBeenCalled()
  })
})
