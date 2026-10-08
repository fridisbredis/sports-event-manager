import { logger } from '@/lib/logger'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import InviteForm from './invite-form'
import { toastError } from '@/lib/toast'

// Returns the i18n key so assertions name the key rather than a translation —
// which is the whole point here: the bug was provider text reaching the user
// instead of a key.
const { fakeT, changeLanguage } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  changeLanguage: vi.fn(),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: fakeT, i18n: { changeLanguage } }),
}))

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

const { signInWithOtp, verifyOtp } = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({ auth: { signInWithOtp, verifyOtp } }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const PHONE = '46701234567'
const RESEND_COOLDOWN_SECONDS = 30

/** Fills the form to the point where the confirm button sends the OTP. */
function fillAndSubmit() {
  render(<InviteForm token="tok-abc" phone={PHONE} name="Anna" />)
  fireEvent.click(screen.getByText('confirmation.availabilityCheck'))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByText('confirmation.confirmButton'))
}

// Supabase's error.message is English, worded for developers, and is raw
// provider text on the client. The sign-in page already mapped these codes to
// keys; this form showed the message verbatim.
describe('InviteForm provider error mapping', () => {
  beforeEach(() => {
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
    // The whole case runs on a frozen clock: the cooldown interval is created
    // when the OTP step opens, so a clock installed afterwards controls
    // nothing and leaves the countdown stuck at its initial value. React state
    // is flushed with act() instead of testing-library's async queries, which
    // poll on timers and cannot settle while those are faked.
    vi.useFakeTimers()
    try {
      signInWithOtp.mockResolvedValueOnce({ error: null })
      fillAndSubmit()

      // Reaching the OTP step is what exposes the resend button. Queried by
      // label rather than placeholder: the label used to be uncoupled from the
      // input, leaving the placeholder as the field's only name.
      await act(async () => {})
      expect(screen.getByLabelText('signIn.codeLabel')).toBeInTheDocument()

      // One second at a time, letting React commit in between: the cooldown
      // effect lists resendCooldown as a dependency, so every tick tears the
      // interval down and schedules a fresh one, and a single large advance
      // would only ever fire the first of them.
      for (let i = 0; i < RESEND_COOLDOWN_SECONDS; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1000)
        })
      }

      signInWithOtp.mockResolvedValueOnce({
        error: { code: 'otp_expired', message: 'Token has expired' },
      })
      fireEvent.click(screen.getByText('signIn.resendCodeButton'))
      await act(async () => {})
    } finally {
      vi.useRealTimers()
    }

    expect(toastError).toHaveBeenCalledWith('signIn.invalidCode')
    expect(toastError).not.toHaveBeenCalledWith('Token has expired')

    // warn, not error: logger.error reports to Sentry (REL-02), and a code the
    // UI already has a message for is a normal outcome, not a fault.
    expect(logger.warn).toHaveBeenCalledWith('[auth] invite OTP resend failed', {
      code: 'otp_expired',
      message: 'Token has expired',
    })
    expect(logger.error).not.toHaveBeenCalled()
  })
})

// The language control moved out of the sticky header into the form flow as a
// <select>. The choice is still only sent when the invitee actually picks one
// — an untouched control must not write a preference, or an absent
// user_preferences row stops meaning "never chose".
describe('InviteForm language selection', () => {
  beforeEach(() => {
    signInWithOtp.mockReset()
    verifyOtp.mockReset()
    fetchMock.mockReset()
    changeLanguage.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  async function confirmWith(pick?: string) {
    signInWithOtp.mockResolvedValue({ error: null })
    verifyOtp.mockResolvedValue({ data: { session: { access_token: 'tok' } }, error: null })
    fetchMock.mockResolvedValue({ ok: true })

    render(<InviteForm token="tok-abc" phone={PHONE} name="Anna" />)
    if (pick !== undefined) {
      fireEvent.change(screen.getByLabelText('confirmation.languageLabel'), {
        target: { value: pick },
      })
    }
    fireEvent.click(screen.getByText('confirmation.availabilityCheck'))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('confirmation.confirmButton'))

    await screen.findByLabelText('signIn.codeLabel')
    fireEvent.change(screen.getByLabelText('signIn.codeLabel'), { target: { value: '123456' } })
    fireEvent.click(screen.getByText('signIn.verifyButton'))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    return JSON.parse(fetchMock.mock.calls[0][1].body)
  }

  it('renders each locale in its own language, not translated', () => {
    render(<InviteForm token="tok-abc" phone={PHONE} name="Anna" />)
    const select = screen.getByLabelText('confirmation.languageLabel')
    expect(select).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Svenska' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'English' })).toBeInTheDocument()
  })

  it('omits language from the confirm call when the invitee never picks one', async () => {
    const body = await confirmWith()
    expect(body).not.toHaveProperty('language')
  })

  it('sends the chosen language on the confirm call', async () => {
    const body = await confirmWith('sv')
    expect(body.language).toBe('sv')
  })

  // The select replaced LanguageSwitcher, which called i18n.changeLanguage
  // itself. Carrying the value in React state alone left the control showing
  // the new language while every string on the page stayed in the old one.
  it('repaints the form in the chosen language', () => {
    render(<InviteForm token="tok-abc" phone={PHONE} name="Anna" />)
    fireEvent.change(screen.getByLabelText('confirmation.languageLabel'), {
      target: { value: 'sv' },
    })
    expect(changeLanguage).toHaveBeenCalledWith('sv')
  })

  it('does not switch language when the value is unchanged', () => {
    render(<InviteForm token="tok-abc" phone={PHONE} name="Anna" />)
    fireEvent.change(screen.getByLabelText('confirmation.languageLabel'), {
      target: { value: 'en' },
    })
    expect(changeLanguage).not.toHaveBeenCalled()
  })
})
