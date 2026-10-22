import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TenantSmsCell } from './tenant-list'

const LABELS = { language: 'sv', ofLabel: 'av', blockedLabel: 'Stoppat' }

function usage(overrides = {}) {
  return {
    tenantId: 't1',
    tenantName: 'Viadal 2026',
    tier: 'professional',
    spentSek: 56,
    segments: 80,
    failed: 0,
    capSek: 300,
    exceeded: false,
    fraction: 0.19,
    usingFallbackRate: false,
    ...overrides,
  }
}

describe('TenantSmsCell', () => {
  it('shows spend against the cap', () => {
    render(<TenantSmsCell usage={usage()} {...LABELS} />)

    expect(screen.getByText('56 kr')).toBeInTheDocument()
    expect(screen.getByText(/av\s*300 kr/)).toBeInTheDocument()
  })

  it('says Blocked when sending has stopped, not just a red number', () => {
    // The one state with a consequence. Colour alone says "high"; the word
    // says what actually happened.
    render(
      <TenantSmsCell usage={usage({ exceeded: true, spentSek: 300, fraction: 1 })} {...LABELS} />
    )

    expect(screen.getByText('Stoppat')).toBeInTheDocument()
  })

  it('does not say Blocked while the tenant is merely close', () => {
    render(<TenantSmsCell usage={usage({ spentSek: 250, fraction: 0.83 })} {...LABELS} />)

    expect(screen.queryByText('Stoppat')).not.toBeInTheDocument()
  })

  it('renders an em dash, not 0 kr, for a tenant with no usage row', () => {
    // readAllTenantSmsUsage returns every tenant, so this means the two lists
    // disagree. "0 kr" would assert something the cell does not know.
    render(<TenantSmsCell usage={undefined} {...LABELS} />)

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/kr/)).not.toBeInTheDocument()
  })

  it('distinguishes approaching from ordinary use by weight', () => {
    const { rerender } = render(<TenantSmsCell usage={usage()} {...LABELS} />)
    expect(screen.getByText('56 kr').className).not.toContain('font-semibold')

    rerender(<TenantSmsCell usage={usage({ spentSek: 250, fraction: 0.83 })} {...LABELS} />)
    expect(screen.getByText('250 kr').className).toContain('font-semibold')
  })
})
