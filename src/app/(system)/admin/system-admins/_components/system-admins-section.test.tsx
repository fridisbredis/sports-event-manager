import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { SystemAdminsSection } from './system-admins-section'
import { toastError } from '@/lib/toast'
import type { SystemAdmin } from '@/lib/auth/system-admins'

// Returns the key, so assertions check which string was chosen without
// depending on the translation files.
vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}))

vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))

const { revokeSystemAdmin } = vi.hoisted(() => ({ revokeSystemAdmin: vi.fn() }))

vi.mock('../../actions', () => ({
  grantSystemAdmin: vi.fn(),
  revokeSystemAdmin,
}))

const SELF: SystemAdmin = {
  userId: 'self',
  name: 'Frida',
  phone: '46700000001',
  createdAt: '2026-07-01T00:00:00Z',
}
const OTHER: SystemAdmin = {
  userId: 'other',
  name: 'Peter',
  phone: '46700000002',
  createdAt: '2026-08-01T00:00:00Z',
}
const DATES = { self: '1 Jul 2026', other: '1 Aug 2026' }

function removeButtonFor(name: string) {
  const row = screen.getByText(name).closest('li')!
  return within(row).getByRole('button', { name: 'systemAdmin.removeAdmin' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('SystemAdminsSection', () => {
  it('marks the signed-in admin and disables removing themselves', () => {
    render(
      <SystemAdminsSection admins={[SELF, OTHER]} currentUserId="self" formattedDates={DATES} />
    )

    const ownButton = removeButtonFor('Frida')
    expect(ownButton).toBeDisabled()
    expect(ownButton).toHaveAttribute('title', 'systemAdmin.cannotRemoveSelfHint')
    expect(
      within(screen.getByText('Frida').closest('li')!).getByText('systemAdmin.systemAdminYou')
    ).toBeInTheDocument()

    expect(removeButtonFor('Peter')).toBeEnabled()
  })

  it('shows the stored number in the same international format as OFF-01', () => {
    render(
      <SystemAdminsSection admins={[SELF, OTHER]} currentUserId="self" formattedDates={DATES} />
    )

    // Stored without '+', as our own normalisation writes it.
    expect(screen.getByText(/^\+46 70 000 00 02 · /)).toBeInTheDocument()
  })

  it('names an unnamed admin by their formatted number in the confirm dialog', async () => {
    render(
      <SystemAdminsSection
        admins={[SELF, { ...OTHER, name: null }]}
        currentUserId="self"
        formattedDates={DATES}
      />
    )

    const row = screen.getByText('systemAdmin.adminUnknownName').closest('li')!
    fireEvent.click(within(row).getByRole('button', { name: 'systemAdmin.removeAdmin' }))

    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText(
        'systemAdmin.removeSystemAdminConfirmBody:{"name":"+46 70 000 00 02"}'
      )
    ).toBeInTheDocument()
  })

  it('disables removing the last system admin, explaining why', () => {
    // Signed in as someone not in the list — e.g. a stale page after their
    // own role changed — so the self rule does not mask the last-admin one.
    render(<SystemAdminsSection admins={[OTHER]} currentUserId="self" formattedDates={DATES} />)

    const button = removeButtonFor('Peter')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'systemAdmin.lastSystemAdminHint')
  })

  it('removes another admin after confirming, naming them in the dialog', async () => {
    revokeSystemAdmin.mockResolvedValue({})
    render(
      <SystemAdminsSection admins={[SELF, OTHER]} currentUserId="self" formattedDates={DATES} />
    )

    fireEvent.click(removeButtonFor('Peter'))
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('systemAdmin.removeSystemAdminConfirmBody:{"name":"Peter"}')
    ).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'systemAdmin.removeAdmin' }))

    await waitFor(() => expect(revokeSystemAdmin).toHaveBeenCalledWith('other'))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('shows the server refusal as a toast', async () => {
    revokeSystemAdmin.mockResolvedValue({ error: 'There must always be at least one.' })
    render(
      <SystemAdminsSection admins={[SELF, OTHER]} currentUserId="self" formattedDates={DATES} />
    )

    fireEvent.click(removeButtonFor('Peter'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'systemAdmin.removeAdmin' }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('There must always be at least one.')
    )
  })
})
