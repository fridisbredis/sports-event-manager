import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import svAdmin from '@/../public/locales/sv/admin.json'
import { AdminOnboardingGuide } from './admin-onboarding-guide'

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}))

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
  forceOpen: false,
  eventConfigComplete: true,
  workAreaCount: 1,
  confirmedOfficialCount: 2,
  assignedShiftCount: 0,
  isPublished: false,
  tierAllowsPublish: true,
}

beforeEach(() => {
  window.localStorage.clear()
  vi.clearAllMocks()
})

describe('AdminOnboardingGuide', () => {
  it('renders labels from the selected locale instead of translation keys', () => {
    render(<AdminOnboardingGuide {...PROPS} />)

    expect(screen.getByText('Kom igång med ditt event')).toBeInTheDocument()
    expect(screen.getByText('Evenemangsinställningar')).toBeInTheDocument()
    expect(screen.getByText('Etapp')).toBeInTheDocument()
    expect(screen.queryByText('onboardingGuide.title')).toBeNull()
  })

  it('remembers when an admin hides the guide for this event', async () => {
    render(<AdminOnboardingGuide {...PROPS} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Jag kan det här – dölj guiden' }))

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Jag kan det här – dölj guiden' })).toBeNull()
    })
    expect(window.localStorage.getItem('admin-onboarding-dismissed:event-1')).toBe('true')
  })

  it('reopens a dismissed guide from the help link request', async () => {
    window.localStorage.setItem('admin-onboarding-dismissed:event-1', 'true')
    const { rerender } = render(<AdminOnboardingGuide {...PROPS} />)

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Jag kan det här – dölj guiden' })).toBeNull()
    })

    rerender(<AdminOnboardingGuide {...PROPS} forceOpen />)

    expect(
      await screen.findByRole('button', { name: 'Jag kan det här – dölj guiden' })
    ).toBeTruthy()
    expect(replace).toHaveBeenCalledWith(
      '/viadal/admin/events/event-1/dashboard#onboarding-glossary',
      { scroll: false }
    )
    expect(window.localStorage.getItem('admin-onboarding-dismissed:event-1')).toBeNull()
  })
})
