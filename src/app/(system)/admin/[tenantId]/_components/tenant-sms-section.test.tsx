import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TenantSmsSection } from './tenant-sms-section'

const LABELS = {
  language: 'sv',
  title: 'SMS denna månad',
  spentLabel: 'Förbrukat',
  capLabel: 'Månadsgräns',
  segmentsLabel: 'Debiterbara segment',
  statusLabel: 'Inbjudningar och meddelanden skickas som vanligt.',
  blockedHint: 'Inbjudningar och meddelanden är stoppade för den här kunden.',
  unavailableHint: 'Förbrukningen kunde inte läsas.',
}

function usage(overrides = {}) {
  return {
    spentAmount: 56,
    segments: 80,
    failed: 0,
    capAmount: 300,
    exceeded: false,
    fraction: 0.19,
    usingFallbackRate: false,
    ...overrides,
  }
}

describe('TenantSmsSection', () => {
  it('shows spend, cap and the segment count behind them', () => {
    render(<TenantSmsSection usage={usage()} {...LABELS} />)

    expect(screen.getByText('56 kr')).toBeInTheDocument()
    expect(screen.getByText('300 kr')).toBeInTheDocument()
    // The billable unit. Kronor are derived from it, so anyone reconciling
    // against a Twilio invoice needs the segments rather than the conversion.
    expect(screen.getByText('80')).toBeInTheDocument()
  })

  it('says sending is normal while under the cap', () => {
    render(<TenantSmsSection usage={usage()} {...LABELS} />)

    expect(screen.getByText(LABELS.statusLabel)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.blockedHint)).not.toBeInTheDocument()
  })

  it('replaces that with the blocked explanation once the cap is reached', () => {
    render(
      <TenantSmsSection
        usage={usage({ exceeded: true, spentAmount: 140, fraction: 1 })}
        {...LABELS}
      />
    )

    expect(screen.getByText(LABELS.blockedHint)).toBeInTheDocument()
    expect(screen.queryByText(LABELS.statusLabel)).not.toBeInTheDocument()
  })

  it('says usage is unreadable rather than rendering zeroes', () => {
    // Zeroes would be indistinguishable from a tenant that has sent nothing.
    render(<TenantSmsSection usage={null} {...LABELS} />)

    expect(screen.getByText(LABELS.unavailableHint)).toBeInTheDocument()
    expect(screen.queryByText('0 kr')).not.toBeInTheDocument()
    expect(screen.queryByText(LABELS.spentLabel)).not.toBeInTheDocument()
  })

  it('shows the estimate hint only when passed one', () => {
    const hint = 'Kronor härleds från segment enligt listpris.'

    const { rerender } = render(<TenantSmsSection usage={usage()} {...LABELS} />)
    expect(screen.queryByText(hint)).not.toBeInTheDocument()

    rerender(<TenantSmsSection usage={usage()} {...LABELS} estimateHint={hint} />)
    expect(screen.getByText(hint)).toBeInTheDocument()
  })
})
