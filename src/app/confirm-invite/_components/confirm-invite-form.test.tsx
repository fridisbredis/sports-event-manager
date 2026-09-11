import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConfirmInviteForm from './confirm-invite-form'
import { confirmInviteByPhone } from '@/lib/actions/confirm-invite-by-phone'
import { toastError } from '@/lib/toast'
import type { PendingOfficialInvite } from '@/lib/auth/tenant'

// Shared translate stub: returns the i18n key, or `key:JSON(vars)` when vars are
// passed, so assertions can check both the key used and the interpolation values
// without depending on real translation strings.
const { fakeT } = vi.hoisted(() => {
  const fakeT = (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key
  return { fakeT }
})

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: fakeT }),
}))

vi.mock('@/lib/toast', () => ({
  toastError: vi.fn(),
}))

vi.mock('@/lib/actions/confirm-invite-by-phone', () => ({
  confirmInviteByPhone: vi.fn(),
}))

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

const MULTIPLE_INVITES_WITH_EXPIRED: PendingOfficialInvite[] = [
  MULTIPLE_INVITES[0],
  {
    tenantId: '33333333-3333-3333-3333-333333333333',
    tenantName: 'Expired Club',
    tenantSlug: 'expired-club',
    expired: true,
  },
]

const SINGLE_EXPIRED_INVITE: PendingOfficialInvite[] = [
  { ...SINGLE_INVITE[0], expired: true },
]

const ALL_EXPIRED_INVITES: PendingOfficialInvite[] = [
  { ...MULTIPLE_INVITES_WITH_EXPIRED[0], expired: true },
  MULTIPLE_INVITES_WITH_EXPIRED[1],
]

// The privacy prefix text sits next to a separate <a> link inside the same
// button, so an exact-string getByText match would fail — this matches the
// <span> wrapper by its own (non-exact) text instead. A real click on it
// bubbles up to the button's onClick like a genuine user click would.
function acceptPrivacy() {
  const prefix = screen.getByText(
    (content, element) =>
      element?.tagName === 'SPAN' && content.startsWith('confirmation.privacyCheckPrefix')
  )
  fireEvent.click(prefix)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ConfirmInviteForm', () => {
  it('does not render a picker for a single pending invite, and auto-selects it', async () => {
    // The real action redirects (throws NEXT_REDIRECT) on success rather than
    // resolving — this stands in for "resolved with no error", which is all
    // the component itself checks (`result?.error`).
    vi.mocked(confirmInviteByPhone).mockResolvedValue({})
    render(<ConfirmInviteForm invites={SINGLE_INVITE} />)

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()

    acceptPrivacy()
    fireEvent.click(screen.getByText('confirmInvite.confirmButton'))

    expect(confirmInviteByPhone).toHaveBeenCalledWith(SINGLE_INVITE[0].tenantId, true)
  })

  it('renders a radio picker for multiple pending invites and keeps confirm disabled until one is chosen', () => {
    render(<ConfirmInviteForm invites={MULTIPLE_INVITES} />)

    expect(screen.getByRole('radiogroup')).toBeInTheDocument()
    expect(screen.getByText('Viadal')).toBeInTheDocument()
    expect(screen.getByText('Other Club')).toBeInTheDocument()

    acceptPrivacy()

    expect(screen.getByText('confirmInvite.confirmButton')).toBeDisabled()
  })

  it('selects a tenant on click and submits its tenantId once privacy is also accepted', async () => {
    // The real action redirects (throws NEXT_REDIRECT) on success rather than
    // resolving — this stands in for "resolved with no error", which is all
    // the component itself checks (`result?.error`).
    vi.mocked(confirmInviteByPhone).mockResolvedValue({})
    render(<ConfirmInviteForm invites={MULTIPLE_INVITES} />)

    const options = screen.getAllByRole('radio')
    fireEvent.click(options[1])
    acceptPrivacy()

    const confirmButton = screen.getByText('confirmInvite.confirmButton')
    expect(confirmButton).not.toBeDisabled()

    fireEvent.click(confirmButton)

    expect(confirmInviteByPhone).toHaveBeenCalledWith(MULTIPLE_INVITES[1].tenantId, true)
  })

  it('disables an expired invite in the picker and does not select it on click', () => {
    render(<ConfirmInviteForm invites={MULTIPLE_INVITES_WITH_EXPIRED} />)

    expect(screen.getByText('confirmInvite.expiredLabel')).toBeInTheDocument()

    const options = screen.getAllByRole('radio')
    const expiredOption = options[1]
    expect(expiredOption).toBeDisabled()

    fireEvent.click(expiredOption)
    acceptPrivacy()

    // Only one non-expired invite exists here, so it's auto-selected (same
    // rule as the single-invite case) — clicking the disabled expired option
    // is a no-op rather than something that needs to un-fill the selection.
    expect(screen.getByText('confirmInvite.confirmButton')).not.toBeDisabled()
  })

  it('keeps confirm disabled when the only pending invite is expired', () => {
    render(<ConfirmInviteForm invites={SINGLE_EXPIRED_INVITE} />)

    expect(screen.getByText('confirmInvite.expiredStateTitle')).toBeInTheDocument()
    expect(screen.getByText('confirmInvite.expiredStateMessage')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByText('confirmation.privacyCheckPrefix')).not.toBeInTheDocument()
    expect(screen.queryByText('confirmInvite.confirmButton')).not.toBeInTheDocument()
  })

  it('shows the expired state when every pending invite is expired', () => {
    render(<ConfirmInviteForm invites={ALL_EXPIRED_INVITES} />)

    expect(screen.getByText('confirmInvite.expiredStateTitle')).toBeInTheDocument()
    expect(screen.getByText('confirmInvite.expiredStateMessage')).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByText('confirmInvite.confirmButton')).not.toBeInTheDocument()
  })

  it('shows an error toast when confirmInviteByPhone resolves with an error', async () => {
    vi.mocked(confirmInviteByPhone).mockResolvedValue({ error: 'not_found' })
    render(<ConfirmInviteForm invites={SINGLE_INVITE} />)

    acceptPrivacy()
    fireEvent.click(screen.getByText('confirmInvite.confirmButton'))

    await vi.waitFor(() => expect(toastError).toHaveBeenCalledWith('confirmInvite.error'))
  })
})
