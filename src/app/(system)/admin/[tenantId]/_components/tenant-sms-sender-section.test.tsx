import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TenantSmsSenderSection } from './tenant-sms-sender-section'
import { toastError, toastSuccess } from '@/lib/toast'

// Returns the key, so assertions check which string was chosen without
// depending on the translation files.
vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}))

vi.mock('@/lib/toast', () => ({ toastError: vi.fn(), toastSuccess: vi.fn() }))

const { setTenantSmsSenderId } = vi.hoisted(() => ({ setTenantSmsSenderId: vi.fn() }))

vi.mock('../../actions', () => ({ setTenantSmsSenderId }))

const TENANT_ID = 't1'

function input() {
  return screen.getByLabelText('systemAdmin.smsSenderLabel')
}

function saveButton() {
  return screen.getByRole('button', { name: 'systemAdmin.smsSenderSave' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TenantSmsSenderSection', () => {
  it('says the name is in use on Professional', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId="Viadal" />)

    expect(
      screen.getByText('systemAdmin.smsSenderActiveHint:{"name":"Viadal"}')
    ).toBeInTheDocument()
  })

  // An editable box below Professional read as if the name were in use.
  it('shows no field below Professional, only that it is a Professional feature', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="premium" smsSenderId={null} />)

    expect(screen.getByText('systemAdmin.smsSenderLockedHint')).toBeInTheDocument()
    expect(screen.queryByLabelText('systemAdmin.smsSenderLabel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/smsSenderKeptHint/)).not.toBeInTheDocument()
  })

  // The downgrade case: the name stays on the row and comes back on upgrade,
  // so the page says so rather than hiding it.
  it('says a name saved before a downgrade is kept', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="standard" smsSenderId="Viadal" />)

    expect(screen.getByText('systemAdmin.smsSenderKeptHint:{"name":"Viadal"}')).toBeInTheDocument()
    expect(screen.queryByLabelText('systemAdmin.smsSenderLabel')).not.toBeInTheDocument()
  })

  it('has no example name in the field', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId={null} />)

    expect(input()).not.toHaveAttribute('placeholder')
  })

  it('says the platform number is used when no name is set', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId={null} />)

    expect(screen.getByText('systemAdmin.smsSenderEmptyHint')).toBeInTheDocument()
  })

  it('disables saving until the value changes', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId="Viadal" />)

    expect(saveButton()).toBeDisabled()
  })

  it('disables saving an invalid name', () => {
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId={null} />)

    fireEvent.change(input(), { target: { value: '12345' } })

    expect(saveButton()).toBeDisabled()
  })

  it('saves a valid name and reports it', async () => {
    setTenantSmsSenderId.mockResolvedValue({})
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId={null} />)

    fireEvent.change(input(), { target: { value: 'Viadal' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled())
    expect(setTenantSmsSenderId).toHaveBeenCalledWith(TENANT_ID, 'Viadal')
    expect(
      screen.getByText('systemAdmin.smsSenderActiveHint:{"name":"Viadal"}')
    ).toBeInTheDocument()
  })

  it('shows the server error and keeps the previous name', async () => {
    setTenantSmsSenderId.mockResolvedValue({ error: 'Failed to update the SMS sender' })
    render(<TenantSmsSenderSection tenantId={TENANT_ID} tier="professional" smsSenderId={null} />)

    fireEvent.change(input(), { target: { value: 'Viadal' } })
    fireEvent.click(saveButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Failed to update the SMS sender'))
    expect(screen.getByText('systemAdmin.smsSenderEmptyHint')).toBeInTheDocument()
  })
})
