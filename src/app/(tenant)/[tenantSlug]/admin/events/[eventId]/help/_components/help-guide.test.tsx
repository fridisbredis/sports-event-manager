import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import svAdmin from '@/../public/locales/sv/admin.json'
import { HelpGuide } from './help-guide'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, number>) => {
      const value = key
        .split('.')
        .reduce<unknown>(
          (current, part) =>
            current && typeof current === 'object'
              ? (current as Record<string, unknown>)[part]
              : undefined,
          svAdmin
        )
      if (typeof value !== 'string') return key
      return Object.entries(values ?? {}).reduce(
        (text, [name, replacement]) => text.replace(`{{${name}}}`, String(replacement)),
        value
      )
    },
  }),
}))

const PROPS = {
  tenantSlug: 'viadal',
  eventId: 'event-1',
  hiddenOnDashboard: false,
  eventConfigComplete: true,
  workAreaCount: 1,
  confirmedOfficialCount: 2,
  assignedShiftCount: 0,
  isPublished: false,
  tierAllowsPublish: true,
}

const SHOW = 'Visa guiden på dashboarden igen'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HelpGuide (B22)', () => {
  it('shows the guide and the glossary even when the guide is hidden on the dashboard', () => {
    render(<HelpGuide {...PROPS} hiddenOnDashboard />)

    expect(screen.getByText('Kom igång med ditt event')).toBeInTheDocument()
    expect(screen.getByText('Etapp')).toBeInTheDocument()
  })

  it('does not touch the dashboard hide choice just by being opened', () => {
    render(<HelpGuide {...PROPS} hiddenOnDashboard />)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('has no hide button, and no restore button when nothing is hidden', () => {
    render(<HelpGuide {...PROPS} />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('brings the guide back to the dashboard on request', async () => {
    render(<HelpGuide {...PROPS} hiddenOnDashboard />)

    fireEvent.click(screen.getByRole('button', { name: SHOW }))

    expect(await screen.findByRole('status')).toHaveTextContent('Guiden visas på dashboarden igen.')
    expect(fetchMock).toHaveBeenCalledWith('/api/account/onboarding-guide', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: 'event-1' }),
    })
    expect(screen.queryByRole('button', { name: SHOW })).toBeNull()
  })

  it('keeps the button and shows an error when bringing the guide back fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(<HelpGuide {...PROPS} hiddenOnDashboard />)

    fireEvent.click(screen.getByRole('button', { name: SHOW }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Det gick inte att visa guiden på dashboarden. Försök igen.'
    )
    await waitFor(() => expect(screen.getByRole('button', { name: SHOW })).toBeEnabled())
  })
})
