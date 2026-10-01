import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import LoginPage from './page'

// Returns the i18n key so assertions name the key rather than a translation.
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

vi.mock('@/lib/toast', () => ({
  toastError: vi.fn(),
  parseRetryAfterMinutes: vi.fn(() => 1),
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// Minimal stand-ins for the HeroUI-backed field wrappers: the real ones render
// a listbox portal and a floating label that make querying the inputs awkward,
// and none of that is what these cases are about.
vi.mock('@/components/ui/form-fields', () => ({
  Input: ({
    label,
    value,
    onValueChange,
    ...rest
  }: {
    label?: string
    value?: string
    onValueChange?: (v: string) => void
    [key: string]: unknown
  }) => (
    <input
      aria-label={label ?? (rest['aria-label'] as string)}
      value={value ?? ''}
      onChange={(e) => onValueChange?.(e.target.value)}
    />
  ),
  Select: ({ label, children }: { label?: string; children?: ReactNode }) => (
    <div aria-label={label}>{children}</div>
  ),
}))

vi.mock('@heroui/react', () => ({
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('./_components/sign-in-button', () => ({
  SignInButton: ({
    children,
    isDisabled,
    ...rest
  }: {
    children?: ReactNode
    isDisabled?: boolean
    [key: string]: unknown
  }) => (
    <button type={rest.type as 'submit' | 'button'} disabled={isDisabled}>
      {children}
    </button>
  ),
}))

vi.mock('./_components/link-action', () => ({
  LinkAction: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
}))

const PHONE = '0701234567'
const E164 = '46701234567'

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit
  return JSON.parse(init.body as string)
}

function verifyCall(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.find((c) => String(c[0]).includes('verify-otp'))
}

// Drives the page from the phone field through to a submitted OTP, which is
// the only path that reaches the verify call these cases assert on.
async function signIn({ chooseLanguage }: { chooseLanguage?: 'EN' | 'SV' } = {}) {
  render(<LoginPage />)

  if (chooseLanguage) {
    fireEvent.click(
      screen.getByRole('button', { name: chooseLanguage === 'SV' ? 'Svenska' : 'English' })
    )
  }

  fireEvent.change(screen.getByLabelText('signIn.phoneLabel'), { target: { value: PHONE } })
  fireEvent.click(screen.getByText('signIn.requestCodeButton'))

  await screen.findByLabelText('signIn.codeLabel')

  fireEvent.change(screen.getByLabelText('signIn.codeLabel'), { target: { value: '000000' } })
  fireEvent.click(screen.getByText('signIn.verifyButton'))
}

describe('LoginPage language carry-over', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  // The regression this file exists for. The page seeds its language state with
  // the default locale, so sending that value unconditionally wrote the default
  // over whatever the user had stored — every sign-in reset a Swedish user back
  // to English, which is exactly what the stored preference is meant to prevent.
  // The server's `if (language)` guard cannot catch this: by then the field is
  // populated and indistinguishable from a real choice.
  it('omits the language entirely when the user never touched the switcher', async () => {
    await signIn()

    await waitFor(() => expect(verifyCall(fetchMock)).toBeDefined())

    expect(bodyOf(verifyCall(fetchMock)!)).toEqual({ phone: E164, token: '000000' })
  })

  it('sends the language when the user picked one', async () => {
    await signIn({ chooseLanguage: 'SV' })

    await waitFor(() => expect(verifyCall(fetchMock)).toBeDefined())

    expect(bodyOf(verifyCall(fetchMock)!)).toEqual({
      phone: E164,
      token: '000000',
      language: 'sv',
    })
  })

  // Clicking the option that is already selected is a no-op in the switcher
  // (it returns early on an unchanged value), so it never reaches onChange and
  // is not treated as a choice. That keeps "no stored row" meaning "never
  // picked" rather than "clicked the default once", which is the distinction
  // the column's missing default exists to preserve.
  it('does not count re-clicking the already-selected option as a choice', async () => {
    await signIn({ chooseLanguage: 'EN' })

    await waitFor(() => expect(verifyCall(fetchMock)).toBeDefined())

    expect(bodyOf(verifyCall(fetchMock)!)).not.toHaveProperty('language')
  })
})
