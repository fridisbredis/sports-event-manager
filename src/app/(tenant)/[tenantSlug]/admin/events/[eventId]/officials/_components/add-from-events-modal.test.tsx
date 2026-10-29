import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AddFromEventsModal, type OfficialCandidate } from './add-from-events-modal'
import { addOfficialsToEvent } from '../actions'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))
vi.mock('../actions', () => ({ addOfficialsToEvent: vi.fn(async () => ({ added: 1 })) }))

const EVENT_ID = '33333333-3333-3333-3333-333333333333'

// Enough rows to bring up the search field.
const CANDIDATES: OfficialCandidate[] = Array.from({ length: 10 }, (_, i) => ({
  id: `00000000-0000-0000-0000-00000000000${i}`,
  name: i < 2 ? `Anna ${i}` : `Bo ${i}`,
  phone: `4670000000${i}`,
  invite_status: 'confirmed',
  events: ['Viadal 2026'],
}))

function renderModal() {
  render(
    <AddFromEventsModal
      open
      onClose={vi.fn()}
      tenantSlug="viadal"
      eventId={EVENT_ID}
      candidates={CANDIDATES}
    />
  )
}

const checked = () => screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked)

beforeEach(() => vi.clearAllMocks())

describe('AddFromEventsModal', () => {
  it('selects and deselects everyone', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'officials.fromEvents.selectAll' }))
    expect(checked()).toHaveLength(10)

    fireEvent.click(screen.getByRole('button', { name: 'officials.fromEvents.deselectAll' }))
    expect(checked()).toHaveLength(0)
  })

  it('with a search, selects only the matches and adds exactly those', async () => {
    renderModal()
    fireEvent.change(screen.getByRole('textbox', { name: 'officials.fromEvents.search' }), {
      target: { value: 'anna' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'officials.fromEvents.selectMatches' }))
    expect(checked()).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /officials\.fromEvents\.addCount/ }))
    await waitFor(() =>
      expect(addOfficialsToEvent).toHaveBeenCalledWith({
        tenantSlug: 'viadal',
        eventId: EVENT_ID,
        officialIds: [CANDIDATES[0].id, CANDIDATES[1].id],
      })
    )
  })
})
