import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

import { FeedbackBoard } from './feedback-board'
import type { TriageItem } from '@/lib/feedback/triage'
import { updateFeedbackStatus } from '../../actions'
import { toastError } from '@/lib/toast'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('../../actions', () => ({ updateFeedbackStatus: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))

function item(overrides: Partial<TriageItem> = {}): TriageItem {
  return {
    id: crypto.randomUUID(),
    type: 'bug',
    title: 'A bug',
    body: 'Details',
    status: 'new',
    user_role: 'official',
    page_path: '/club/events/x',
    created_at: '2026-11-27T09:00:00.000Z',
    updated_at: '2026-11-27T09:00:00.000Z',
    tenantName: 'Club',
    eventName: 'Relay',
    senderName: 'Anna',
    senderPhone: '+46700000001',
    imageUrl: null,
    ...overrides,
  }
}

const column = (type: string) =>
  screen.getByRole('region', { name: new RegExp(`feedback\\.triage\\.columns\\.${type}`) })

beforeEach(() => vi.clearAllMocks())

describe('FeedbackBoard', () => {
  it('sorts the rows into one column per type', () => {
    render(
      <FeedbackBoard
        includeClosed={false}
        items={[
          item({ type: 'question', title: 'Q1' }),
          item({ type: 'bug', title: 'B1' }),
          item({ type: 'bug', title: 'B2' }),
        ]}
      />
    )

    expect(within(column('question')).getByText('Q1')).toBeInTheDocument()
    expect(within(column('bug')).getAllByRole('listitem')).toHaveLength(2)
    expect(within(column('feature')).getByText('feedback.triage.empty')).toBeInTheDocument()
  })

  it('shows sender, organisation, event and page on a card', () => {
    render(<FeedbackBoard includeClosed={false} items={[item()]} />)

    expect(screen.getByText('Anna')).toBeInTheDocument()
    expect(screen.getByText(/\+46700000001/)).toBeInTheDocument()
    expect(screen.getByText(/Club/)).toBeInTheDocument()
    expect(screen.getByText(/Relay/)).toBeInTheDocument()
    expect(screen.getByText('/club/events/x')).toBeInTheDocument()
  })

  it('does not repeat a phone number that is also the name', () => {
    render(
      <FeedbackBoard
        includeClosed={false}
        items={[item({ senderName: '46700000001', senderPhone: '+46700000001' })]}
      />
    )

    expect(screen.queryByText(/\+46700000001/)).not.toBeInTheDocument()
  })

  it('saves a new status', async () => {
    vi.mocked(updateFeedbackStatus).mockResolvedValue({})
    const row = item()
    render(<FeedbackBoard includeClosed={false} items={[row]} />)

    fireEvent.change(screen.getByLabelText('feedback.triage.statusLabel'), {
      target: { value: 'done' },
    })

    await waitFor(() => expect(updateFeedbackStatus).toHaveBeenCalledWith(row.id, 'done'))
    expect(screen.getByLabelText('feedback.triage.statusLabel')).toHaveValue('done')
  })

  it('puts the status back and says so when the save fails', async () => {
    vi.mocked(updateFeedbackStatus).mockResolvedValue({ error: 'Could not change the status' })
    render(<FeedbackBoard includeClosed={false} items={[item({ status: 'in_progress' })]} />)

    fireEvent.change(screen.getByLabelText('feedback.triage.statusLabel'), {
      target: { value: 'declined' },
    })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not change the status'))
    expect(screen.getByLabelText('feedback.triage.statusLabel')).toHaveValue('in_progress')
  })
})
