import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { I18nProvider } from '@/components/i18n-provider'
import LoginPage from './page'

// Deliberately NOT mocking @/lib/i18n/client or i18next here, unlike
// page.test.tsx: the bug this file covers was a disagreement between the real
// i18next instance (seeded by the provider with the server's language) and the
// page's own language state, and a faked t() hides exactly that.

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

vi.mock('@/components/ui/form-fields', () => ({
  Input: ({ label }: { label?: string }) => <input aria-label={label} />,
  Select: ({ label, children }: { label?: string; children?: ReactNode }) => (
    <div aria-label={label}>{children}</div>
  ),
}))

vi.mock('@heroui/react', () => ({
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('./_components/sign-in-button', () => ({
  SignInButton: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
}))

vi.mock('./_components/link-action', () => ({
  LinkAction: ({ children }: { children?: ReactNode }) => <button>{children}</button>,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('LoginPage language agreement', () => {
  // The hydration mismatch. The root layout resolves the signed-in user's
  // stored language and seeds i18next with it, so a Swedish user who signs out
  // lands on a /login whose strings are Swedish. The page used to seed its own
  // language state with defaultLocale regardless, so the switcher rendered its
  // English label next to Swedish text — on the server it came out "Språk", on
  // the client "Language", and React reported a hydration mismatch.
  //
  // Asserting on the switcher's own group label is what makes this a
  // regression test rather than a restatement: that label is produced by t(),
  // the i18next side, while the pressed state below comes from the page's
  // state. The bug was precisely these two disagreeing.
  it('renders the switcher in the language the provider resolved', () => {
    render(
      <I18nProvider language="sv">
        <LoginPage />
      </I18nProvider>
    )

    expect(screen.getByRole('group', { name: 'Språk' })).toBeInTheDocument()
  })

  it('marks the provider language as the selected option, not the default', () => {
    render(
      <I18nProvider language="sv">
        <LoginPage />
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: 'Svenska' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false')
  })

  // The signed-out path, which is the common one: no stored preference means
  // the provider publishes the default and nothing should have changed.
  it('falls back to the default locale when the provider has no language', () => {
    render(
      <I18nProvider>
        <LoginPage />
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true')
  })
})
