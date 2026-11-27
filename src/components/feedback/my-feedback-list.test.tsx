import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { MyFeedbackList } from './my-feedback-list'
import type { OwnFeedback } from '@/lib/feedback/queries'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

function row(overrides: Partial<OwnFeedback> = {}): OwnFeedback {
  return {
    id: crypto.randomUUID(),
    type: 'bug',
    title: 'The map is grey',
    body: 'It never loads.',
    status: 'new',
    created_at: '2026-11-27T09:00:00.000Z',
    image_path: null,
    ...overrides,
  }
}

describe('MyFeedbackList', () => {
  it('shows each row with its status', () => {
    render(
      <MyFeedbackList
        rows={[
          row({ title: 'First', status: 'in_progress' }),
          row({ title: 'Second', status: 'declined' }),
        ]}
      />
    )

    expect(screen.getByText('First')).toBeInTheDocument()
    expect(screen.getByText('feedback.status.in_progress')).toBeInTheDocument()
    expect(screen.getByText('feedback.status.declined')).toBeInTheDocument()
  })

  it('marks a row that has an image', () => {
    render(<MyFeedbackList rows={[row({ image_path: 't/u/f/image.png' })]} />)

    expect(screen.getByText('feedback.mine.imageAttached')).toBeInTheDocument()
  })

  it('says so when nothing has been sent', () => {
    render(<MyFeedbackList rows={[]} />)

    expect(screen.getByText('feedback.mine.empty')).toBeInTheDocument()
  })

  // F-REL-10: a failed read must not look like an empty history.
  it('says the list could not be loaded instead of showing it as empty', () => {
    render(<MyFeedbackList rows={[]} failed />)

    expect(screen.getByText('feedback.mine.loadFailed')).toBeInTheDocument()
    expect(screen.queryByText('feedback.mine.empty')).not.toBeInTheDocument()
  })
})
