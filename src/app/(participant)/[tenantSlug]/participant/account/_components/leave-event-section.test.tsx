import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { LeaveEventSection } from './leave-event-section'

const { fakeT } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, string>) =>
    vars?.event ? `${key}:${vars.event}` : key,
}))
vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: fakeT }) }))
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))
vi.mock('@/components/ui/app-card', () => ({
  AppCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
// A plain stand-in for the HeroUI modal: rendered only while open.
vi.mock('@/components/confirm-dialog', () => ({
  default: ({
    open,
    title,
    confirmLabel,
    onConfirm,
  }: {
    open: boolean
    title: string
    confirmLabel: string
    onConfirm: () => void
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button onClick={onConfirm}>{confirmLabel}</button>
      </div>
    ) : null,
}))
vi.mock('../actions', () => ({ leaveParticipantEvent: vi.fn() }))

import { leaveParticipantEvent } from '../actions'
import { toastError } from '@/lib/toast'

const events = [
  { eventId: 'e1', eventName: 'Viadal 2026' },
  { eventId: 'e2', eventName: 'Höstrundan' },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LeaveEventSection', () => {
  it('renders nothing without events', () => {
    const { container } = render(<LeaveEventSection tenantSlug="viadal" events={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('offers one leave action per event, named for screen readers', () => {
    render(<LeaveEventSection tenantSlug="viadal" events={events} />)
    expect(
      screen.getByRole('button', { name: 'participant.account.leaveAria:Viadal 2026' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'participant.account.leaveAria:Höstrundan' })
    ).toBeInTheDocument()
  })

  it('asks first, then leaves only the chosen event', async () => {
    vi.mocked(leaveParticipantEvent).mockResolvedValue({})
    render(<LeaveEventSection tenantSlug="viadal" events={events} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'participant.account.leaveAria:Höstrundan' })
    )
    expect(leaveParticipantEvent).not.toHaveBeenCalled()
    expect(
      screen.getByRole('dialog', { name: 'participant.account.leaveConfirmTitle:Höstrundan' })
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'participant.account.leaveConfirm' }))
    await waitFor(() =>
      expect(leaveParticipantEvent).toHaveBeenCalledWith({ tenantSlug: 'viadal', eventId: 'e2' })
    )
  })

  it('shows the error and closes the dialog when leaving fails', async () => {
    vi.mocked(leaveParticipantEvent).mockResolvedValue({ error: 'gone' })
    render(<LeaveEventSection tenantSlug="viadal" events={events} />)

    fireEvent.click(
      screen.getByRole('button', { name: 'participant.account.leaveAria:Viadal 2026' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'participant.account.leaveConfirm' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('gone'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
