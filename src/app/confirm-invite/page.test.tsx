import { describe, it, expect, vi, beforeEach } from 'vitest'
import ConfirmInvitePage from './page'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getPendingOfficialInvitesByPhone, type PendingOfficialInvite } from '@/lib/auth/tenant'
import { redirect } from 'next/navigation'
import ConfirmInviteForm from './_components/confirm-invite-form'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock('@/lib/auth/tenant', () => ({
  getPendingOfficialInvitesByPhone: vi.fn(),
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

const SINGLE_INVITE: PendingOfficialInvite[] = [
  {
    tenantId: '11111111-1111-1111-1111-111111111111',
    tenantName: 'Viadal',
    tenantSlug: 'viadal',
    expired: false,
  },
]

const MULTIPLE_INVITES: PendingOfficialInvite[] = [
  ...SINGLE_INVITE,
  {
    tenantId: '22222222-2222-2222-2222-222222222222',
    tenantName: 'Other Club',
    tenantSlug: 'other-club',
    expired: false,
  },
]

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
    expect(getPendingOfficialInvitesByPhone).not.toHaveBeenCalled()
  })

  it('redirects to / for a logged-in user with no phone on the session (e.g. email-only account, if one existed)', async () => {
    mockAuthedUser({ id: 'user-1' })

    await expect(ConfirmInvitePage()).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/')
    expect(getPendingOfficialInvitesByPhone).not.toHaveBeenCalled()
  })

  it('redirects to / when the session phone has no pending invite — e.g. an admin, a confirmed official, or any random authenticated user poking the URL', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(getPendingOfficialInvitesByPhone).mockResolvedValue([])

    await expect(ConfirmInvitePage()).rejects.toThrow('NEXT_REDIRECT')

    expect(redirect).toHaveBeenCalledWith('/')
  })

  it('renders the consent form with a single pending invite passed through as invites', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(getPendingOfficialInvitesByPhone).mockResolvedValue(SINGLE_INVITE)

    const result = await ConfirmInvitePage()

    expect(getPendingOfficialInvitesByPhone).toHaveBeenCalledWith('+46701234567')
    expect((result as { type: unknown }).type).toBe(ConfirmInviteForm)
    expect((result as { props: { invites: PendingOfficialInvite[] } }).props.invites).toEqual(
      SINGLE_INVITE
    )
  })

  it('renders the consent form with all pending invites when the phone has more than one', async () => {
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(getPendingOfficialInvitesByPhone).mockResolvedValue(MULTIPLE_INVITES)

    const result = await ConfirmInvitePage()

    expect((result as { props: { invites: PendingOfficialInvite[] } }).props.invites).toEqual(
      MULTIPLE_INVITES
    )
  })

  it('never passes any client-suppliable value into the pending-invite lookup — only the verified session phone', async () => {
    // There is no searchParams/props argument this page reads at all (it
    // takes no props), so there is no query string or body a URL-manipulating
    // caller could use to target a different phone number's invites. This
    // pins that absence: getPendingOfficialInvitesByPhone is called with
    // exactly one argument, sourced only from the authenticated session.
    mockAuthedUser({ id: 'user-1', phone: '+46701234567' })
    vi.mocked(getPendingOfficialInvitesByPhone).mockResolvedValue(SINGLE_INVITE)

    await ConfirmInvitePage()

    expect(getPendingOfficialInvitesByPhone).toHaveBeenCalledTimes(1)
    expect(getPendingOfficialInvitesByPhone).toHaveBeenCalledWith('+46701234567')
  })
})
