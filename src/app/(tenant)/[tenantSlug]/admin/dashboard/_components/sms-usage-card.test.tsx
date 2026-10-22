import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SmsUsageCard } from './sms-usage-card'

const BASE = {
  title: 'SMS this month',
  amountLabel: '56 kr of 300 kr',
  okLabel: 'Within limit',
  approachingLabel: 'Approaching limit',
  reachedLabel: 'Limit reached',
  blockedExplanation:
    'Invites and announcements have stopped sending until the start of next month. Sign-in codes are not affected.',
}

/** A tenant well under its cap — the state this card is in most of the year. */
function quiet(overrides = {}) {
  return { ...BASE, spentAmount: 56, capAmount: 300, fraction: 0.19, exceeded: false, ...overrides }
}

describe('SmsUsageCard', () => {
  it('stays a single quiet line when there is nothing to act on', () => {
    render(<SmsUsageCard {...quiet()} />)

    expect(screen.getByText('56 kr of 300 kr')).toBeInTheDocument()
    expect(screen.getByText('Within limit')).toBeInTheDocument()

    // No meter below the threshold. A permanently near-empty bar trains the
    // eye to ignore it, which defeats the point of having one.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    // And no alarming copy when nothing is wrong.
    expect(screen.queryByText(BASE.blockedExplanation)).not.toBeInTheDocument()
  })

  it('shows the bar and warns once spend approaches the cap', () => {
    render(<SmsUsageCard {...quiet({ spentAmount: 250, fraction: 0.83 })} />)

    expect(screen.getByText('Approaching limit')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '83')
    // Still sending, so the stopped-sending sentence must not appear yet.
    expect(screen.queryByText(BASE.blockedExplanation)).not.toBeInTheDocument()
  })

  it('does not warn just below the threshold', () => {
    // 79% is still ordinary use. The boundary is worth pinning: an off-by-one
    // here means either a bar that never appears or one that always does.
    render(<SmsUsageCard {...quiet({ fraction: 0.79 })} />)

    expect(screen.getByText('Within limit')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('says plainly that sending has stopped, and that login is unaffected', () => {
    // The reason the card exists. Without this sentence a capped admin sees
    // invites vanish with no explanation anywhere in the app.
    render(<SmsUsageCard {...quiet({ spentAmount: 300, fraction: 1, exceeded: true })} />)

    expect(screen.getByText('Limit reached')).toBeInTheDocument()
    expect(screen.getByText(BASE.blockedExplanation)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  })

  it('shows the estimate note only when the rate is not configured', () => {
    const note = "Estimated from Twilio's list price."

    const { rerender } = render(<SmsUsageCard {...quiet()} />)
    expect(screen.queryByText(note)).not.toBeInTheDocument()

    rerender(<SmsUsageCard {...quiet({ estimateNote: note })} />)
    expect(screen.getByText(note)).toBeInTheDocument()
  })

  it('keeps the bar visible at a tiny non-zero fraction', () => {
    // A 0.3%-wide div rounds away to nothing on screen. Once the bar is shown
    // at all it has to be visible, or "over the line" reads as "empty".
    render(<SmsUsageCard {...quiet({ fraction: 1, exceeded: true })} />)

    const fill = screen.getByRole('progressbar').firstElementChild as HTMLElement
    expect(parseFloat(fill.style.width)).toBeGreaterThanOrEqual(2)
  })
})
