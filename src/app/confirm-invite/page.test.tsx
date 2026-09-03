import { describe, it, expect, vi, beforeEach } from 'vitest'
import ConfirmInvitePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasPendingOfficialInviteByPhone } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import ConfirmInviteForm from './_components/confirm-invite-form'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  hasPendingOfficialInviteByPhone: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT')
  }),
}))

vi.mock('./_components/confirm-invite-form', () => ({
  default: vi.fn(() => null),
}))

function mockAuthedUser(user: { id: string; phone?: string } | null) {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// URL manipulation is exactly the threat this page's own docstring calls
// out: it says it's "only reachable via the redirect in page.tsx" but
// re-checks anyway rather than trusting the referrer. These tests attack
// that claim directly — every case here simulates someone typing
// /confirm-invite into the address bar, not clicking through the intended
// flow.
describe('ConfirmInvitePage (adversarial: direct URL navigation)', () => {
  it('redirects to /login when navigated to directly with no session', async () => {
    mockAuthedUser(null)

    await expect(ConfirmInvitePage()).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/login')
    expect(hasPendingOfficialInviteByPhone).not.toHaveBeenCalled()
  })

  it('redirects to / for a logged-in user with no phone on the session (e.g. email-only account, if one existed)', async () => {
    mockAuthedUser({ id: 'user-1' })

    await expect(ConfirmInvitePage()).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/')
    expect(hasPendingOfficialInviteByPhone).not.toHaveBeenCalled()
  })

  it('redirects to / when the session phone has no pending invite — e.g. an admin, a confirmed official, or any random authenticated user poking the URL', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(hasPendingOfficialInviteByPhone).mockResolvedValue(false)

    await expect(ConfirmInvitePage()).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('renders the consent form only when the session phone genuinely has a pending invite', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(hasPendingOfficialInviteByPhone).mockResolvedValue(true)

    const result = await ConfirmInvitePage()

    expect(hasPendingOfficialInviteByPhone).toHaveBeenCalledWith('+46701234567')
    expect((result as { type: unknown }).type).toBe(ConfirmInviteForm)
  })

  it('never passes any client-suppliable value into the pending-invite check — only the verified session phone', async () => {
    // There is no searchParams/props argument this page reads at all (it
    // takes no props), so there is no query string or body a URL-manipulating
    // caller could use to target a different phone number's invite. This
    // pins that absence: hasPendingOfficialInviteByPhone is called with
    // exactly one argument, sourced only from the authenticated session.
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(hasPendingOfficialInviteByPhone).mockResolvedValue(true)

    await ConfirmInvitePage()

    expect(hasPendingOfficialInviteByPhone).toHaveBeenCalledTimes(1)
    expect(hasPendingOfficialInviteByPhone).toHaveBeenCalledWith('+46701234567')
  })
})
