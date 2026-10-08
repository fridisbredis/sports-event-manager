import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PrivacyPage from './page'
import { getCurrentUser } from '@/lib/auth/tenant'

vi.mock('@/lib/auth/tenant', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/i18n/user-language', () => ({ getUserLanguage: vi.fn(async () => 'en') }))

// Returns the key, so assertions name the key rather than a translation.
vi.mock('@/lib/i18n/server', () => ({
  getServerTranslation: vi.fn(async () => (key: string) => key),
}))

const mockGetCurrentUser = vi.mocked(getCurrentUser)

async function renderPage() {
  render(await PrivacyPage())
}

describe('PrivacyPage back link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The page is reached from sign-in and the invite forms (signed out) and
  // from the account screens and the system sidebar (signed in). One href
  // serves both because '/' routes by session; only the wording differs.
  it('offers to sign in when there is no session', async () => {
    mockGetCurrentUser.mockResolvedValue(null)

    await renderPage()

    const link = screen.getByText('privacyPage.backToSignIn').closest('a')
    expect(link?.getAttribute('href')).toBe('/')
  })

  it('does not say "sign in" to someone already signed in', async () => {
    // The regression this guards: a reader who clicked through from their own
    // account screen was told to go and sign in, which they already had.
    mockGetCurrentUser.mockResolvedValue({ id: 'u1' } as never)

    await renderPage()

    expect(screen.queryByText('privacyPage.backToSignIn')).toBeNull()
    const link = screen.getByText('privacyPage.back').closest('a')
    expect(link?.getAttribute('href')).toBe('/')
  })

  it('states the draft status regardless of session', async () => {
    // The provisional notice is the one thing that must not depend on who is
    // reading: it is why the terms below it cannot yet be relied on.
    mockGetCurrentUser.mockResolvedValue(null)

    await renderPage()

    expect(screen.queryByText('privacyPage.draftBadge')).toBeTruthy()
  })
})
