import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import InviteForm from './invite-form'
import { toastError } from '@/lib/toast'

// Returns the i18n key so assertions name the key rather than a translation —
// which is the whole point here: the bug was provider text reaching the user
// instead of a key.
const { fakeT } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: fakeT }) }))

vi.mock('i18next', () => ({
  default: { changeLanguage: vi.fn(), language: 'en' },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

const { signInWithOtp } = vi.hoisted(() => ({ signInWithOtp: vi.fn() }))

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOtp, verifyOtp: vi.fn() } }),
}))

const PHONE = '46701234567'
const RESEND_COOLDOWN_MS = 30_000

/** Fills the form to the point where the confirm button sends the OTP. */
function fillAndSubmit() {
  render(<InviteForm token="tok-abc" phone={PHONE} name="Anna" />)
  fireEvent.click(screen.getByText('confirmation.availabilityCheck'))
  fireEvent.click(screen.getByText('confirmation.privacyCheckPrefix'))
  fireEvent.click(screen.getByText('confirmation.confirmButton'))
}

// Supabase's error.message is English, worded for developers, and is raw
// provider text on the client. The sign-in page already mapped these codes to
// keys; this form showed the message verbatim.
describe('InviteForm provider error mapping', () => {
  beforeEach(() => {
    // Installed before any render: the cooldown interval is created on mount,
    // and a clock swapped in afterwards would not control it.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    signInWithOtp.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows the mapped key, never the provider message, for a known code', async () => {
    signInWithOtp.mockResolvedValue({
      error: { code: 'over_sms_send_rate_limit', message: 'SMS rate limit exceeded' },
    })

    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith('signIn.tooManyRequests')
    expect(toastError).not.toHaveBeenCalledWith('SMS rate limit exceeded')
  })

  it('falls back to the generic key for an unmapped code', async () => {
    signInWithOtp.mockResolvedValue({
      error: { code: 'something_new', message: 'Database connection failed at 10.0.0.4' },
    })

    fillAndSubmit()

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith('signIn.error')
    // The important half: an unrecognised code must not fall through to the
    // provider's own text, which can carry internal detail like a host.
    expect(toastError).not.toHaveBeenCalledWith('Database connection failed at 10.0.0.4')
  })

  it('maps the error on the resend path too', async () => {
    signInWithOtp.mockResolvedValueOnce({ error: null })
    fillAndSubmit()

    // Reaching the OTP step is what exposes the resend button. Queried by
    // placeholder, not label: this form's OTP field is a raw input whose
    // <label> has no htmlFor, so getByLabelText does not reach it.
    await screen.findByPlaceholderText('000000')

    // Resend opens on a 30s cooldown, so the button stays disabled and
    // labelled with the countdown until the interval has ticked it down.
    await act(async () => {
      vi.advanceTimersByTime(RESEND_COOLDOWN_MS)
    })

    signInWithOtp.mockResolvedValueOnce({
      error: { code: 'otp_expired', message: 'Token has expired' },
    })
    fireEvent.click(screen.getByText('signIn.resendCodeButton'))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(toastError).toHaveBeenCalledWith('signIn.invalidCode')
    expect(toastError).not.toHaveBeenCalledWith('Token has expired')
  })
})
