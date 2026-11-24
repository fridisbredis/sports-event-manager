import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import svAdmin from '@/../public/locales/sv/admin.json'
import { AdminOnboardingGuide } from './admin-onboarding-guide'

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
  initiallyDismissed: false,
  eventConfigComplete: true,
  workAreaCount: 1,
  confirmedOfficialCount: 2,
  assignedShiftCount: 0,
  isPublished: false,
  tierAllowsPublish: true,
}

const HIDE = 'Jag kan det här – dölj guiden'
const LEGACY_KEY = 'admin-onboarding-dismissed:event-1'

const fetchMock = vi.fn()

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
  fetchMock.mockResolvedValue({ ok: true })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function callsTo(method: 'PUT' | 'DELETE') {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === method)
}

describe('AdminOnboardingGuide', () => {
  it('renders labels from the selected locale instead of translation keys', () => {
    render(<AdminOnboardingGuide {...PROPS} />)

    expect(screen.getByText('Kom igång med ditt event')).toBeInTheDocument()
    expect(screen.getByText('Evenemangsinställningar')).toBeInTheDocument()
    expect(screen.getByText('Etapp')).toBeInTheDocument()
    expect(screen.queryByText('onboardingGuide.title')).toBeNull()
  })

  it('renders nothing when the user has already hidden the guide for this event', () => {
    const { container } = render(<AdminOnboardingGuide {...PROPS} initiallyDismissed />)

    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('saves the hidden guide on the user, not in the browser', async () => {
    render(<AdminOnboardingGuide {...PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: HIDE }))

    await waitFor(() => expect(screen.queryByRole('button', { name: HIDE })).toBeNull())
    expect(fetchMock).toHaveBeenCalledWith('/api/account/onboarding-guide', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId: 'event-1' }),
    })
    expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('brings the guide back with an error when the save fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    render(<AdminOnboardingGuide {...PROPS} />)

    fireEvent.click(screen.getByRole('button', { name: HIDE }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Det gick inte att dölja guiden. Försök igen.'
    )
    expect(screen.getByRole('button', { name: HIDE })).toBeInTheDocument()
  })

  it('points the publish step at the dashboard publish section by full path', () => {
    render(<AdminOnboardingGuide {...PROPS} />)

    expect(screen.getByRole('link', { name: 'Publicera eventet' })).toHaveAttribute(
      'href',
      '/viadal/admin/events/event-1/dashboard#publish-status'
    )
  })

  it('carries over a choice made in localStorage before it moved onto the user', async () => {
    window.localStorage.setItem(LEGACY_KEY, 'true')
    render(<AdminOnboardingGuide {...PROPS} />)

    await waitFor(() => expect(screen.queryByRole('button', { name: HIDE })).toBeNull())
    expect(callsTo('PUT')).toHaveLength(1)
    await waitFor(() => expect(window.localStorage.getItem(LEGACY_KEY)).toBeNull())
  })

  it('keeps the localStorage choice for another try when carrying it over fails', async () => {
    fetchMock.mockResolvedValue({ ok: false })
    window.localStorage.setItem(LEGACY_KEY, 'true')
    render(<AdminOnboardingGuide {...PROPS} />)

    await waitFor(() => expect(callsTo('PUT')).toHaveLength(1))
    expect(window.localStorage.getItem(LEGACY_KEY)).toBe('true')
  })
})
