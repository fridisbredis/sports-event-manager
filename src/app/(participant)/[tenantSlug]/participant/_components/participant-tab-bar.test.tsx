import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ParticipantTabBar } from './participant-tab-bar'

// B29: the Event info tab has to lead to event info and be lit there, with one
// event and with several. The layout test mocks the bar away, so this renders
// it for real against a given pathname.

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children?: ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderBar(pathname: string, soleEventId: string | null) {
  mockPathname.mockReturnValue(pathname)
  return render(<ParticipantTabBar tenantSlug="viadal" soleEventId={soleEventId} />)
}

function infoTab() {
  return screen.getByRole('link', { name: /participant\.nav\.eventInfo/ })
}

function activeHrefs() {
  return screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.getAttribute('href'))
}

describe('ParticipantTabBar — Event info tab (B29)', () => {
  it('opens the only event directly', () => {
    renderBar('/viadal/participant', 'e1')
    expect(infoTab().getAttribute('href')).toBe('/viadal/participant/events/e1/info')
  })

  it('opens the event picker when the participant has several events, not Start', () => {
    renderBar('/viadal/participant', null)
    expect(infoTab().getAttribute('href')).toBe('/viadal/participant/events')
  })

  it('is lit on the picker', () => {
    renderBar('/viadal/participant/events', null)
    expect(activeHrefs()).toEqual(['/viadal/participant/events'])
  })

  it('is lit on an info page reached from Start, with several events', () => {
    renderBar('/viadal/participant/events/e2/info', null)
    expect(activeHrefs()).toEqual(['/viadal/participant/events'])
  })

  it('is lit on the info page of the only event', () => {
    renderBar('/viadal/participant/events/e1/info', 'e1')
    expect(activeHrefs()).toEqual(['/viadal/participant/events/e1/info'])
  })

  it('leaves Start as the only lit tab on Start', () => {
    renderBar('/viadal/participant', null)
    expect(activeHrefs()).toEqual(['/viadal/participant'])
  })
})
