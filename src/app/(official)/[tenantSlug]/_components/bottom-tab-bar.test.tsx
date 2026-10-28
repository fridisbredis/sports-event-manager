import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BottomTabBar } from './bottom-tab-bar'

// The layout test mocks this component away, so which tab is marked active —
// the one thing the bar has to get right — had no coverage. These tests render
// it for real against a given pathname.

const { mockPathname, mockPush, mockParams } = vi.hoisted(() => ({
  mockPathname: vi.fn(),
  mockPush: vi.fn(),
  mockParams: vi.fn(
    () => ({ tenantSlug: 'seed-klubben', eventId: 'e1' }) as Record<string, string>
  ),
}))

// The bar navigates through the router now, so it needs one mounted — the
// tap has to move the highlight before the pathname catches up.
vi.mock('next/navigation', () => ({
  usePathname: mockPathname,
  useParams: mockParams,
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
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

function renderBar(pathname: string, showAccount = true) {
  mockPathname.mockReturnValue(pathname)
  return render(
    <BottomTabBar tenantSlug="seed-klubben" showAccount={showAccount} defaultEventId={null} />
  )
}

// Selected by href like the assertions above: the labels come from i18n,
// which these tests deliberately leave unmocked.
function tabLink(href: string) {
  return screen.getAllByRole('link').find((el) => el.getAttribute('href') === href)!
}

function activeHrefs() {
  return screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.getAttribute('href'))
}

describe('BottomTabBar', () => {
  beforeEach(() => mockPush.mockClear())

  it('renders one link per tab', () => {
    renderBar('/seed-klubben/events/e1/home')

    expect(screen.getAllByRole('link')).toHaveLength(5)
  })

  // ACCT-01 is backed by an `officials` row, and the page answers notFound()
  // without one — so for a role-only admin (a global system_admin holds no
  // roster row in any tenant) the tab is omitted rather than leading to a 404.
  it('omits the account tab when the caller has no officials row', () => {
    renderBar('/seed-klubben/events/e1/home', false)

    const hrefs = screen.getAllByRole('link').map((el) => el.getAttribute('href'))
    expect(hrefs).toHaveLength(4)
    expect(hrefs).not.toContain('/seed-klubben/account')
  })

  it('marks exactly the tab matching the current path', () => {
    renderBar('/seed-klubben/events/e1/schedule')

    expect(activeHrefs()).toEqual(['/seed-klubben/events/e1/schedule'])
  })

  it('marks the parent tab on a nested route', () => {
    renderBar('/seed-klubben/events/e1/event-info/stage-2')

    expect(activeHrefs()).toEqual(['/seed-klubben/events/e1/event-info'])
  })

  it('marks no tab on a path outside the bar', () => {
    renderBar('/seed-klubben/events/e1/something-else')

    expect(activeHrefs()).toEqual([])
  })

  it('does not treat a sibling with a shared prefix as active', () => {
    // '/schedule-archive' starts with '/schedule' as a string but is a
    // different route, so only a '/' boundary may count as nesting.
    renderBar('/seed-klubben/events/e1/schedule-archive')

    expect(activeHrefs()).toEqual([])
  })

  // Tapping a tab starts a navigation that the pathname only reflects once it
  // commits. These cover the gap in between.
  it('navigates through the router rather than a full page load', () => {
    renderBar('/seed-klubben/events/e1/home')

    fireEvent.click(tabLink('/seed-klubben/events/e1/schedule'))

    expect(mockPush).toHaveBeenCalledWith('/seed-klubben/events/e1/schedule')
  })

  it('leaves modified clicks to the browser so a tab can be opened', () => {
    renderBar('/seed-klubben/events/e1/home')

    fireEvent.click(tabLink('/seed-klubben/events/e1/schedule'), { metaKey: true })

    expect(mockPush).not.toHaveBeenCalled()
  })

  // aria-current trails the visual highlight on purpose: announcing the new
  // tab while the previous page is still mounted would misreport where the
  // user is.
  it('keeps aria-current on the tab actually rendered', () => {
    renderBar('/seed-klubben/events/e1/home')

    fireEvent.click(tabLink('/seed-klubben/events/e1/schedule'))

    expect(activeHrefs()).toEqual(['/seed-klubben/events/e1/home'])
  })

  it('distinguishes the active tab by more than colour alone', () => {
    // Colour is the primary marker, but it must not be the only one — so the
    // active tab's icon also carries a heavier stroke.
    const { container } = renderBar('/seed-klubben/events/e1/home')

    const strokeWidth = (href: string) =>
      Number(container.querySelector(`a[href="${href}"] svg`)?.getAttribute('stroke-width'))

    expect(strokeWidth('/seed-klubben/events/e1/home')).toBeGreaterThan(
      strokeWidth('/seed-klubben/account')
    )
  })

  // N23: ACCT-01 has no event in its URL, so the event tabs fall back to the
  // caller's only event, or to the picker when there is no single one.
  describe('without an event in the URL', () => {
    beforeEach(() => mockParams.mockReturnValue({ tenantSlug: 'seed-klubben' }))

    it("opens the caller's only event", () => {
      mockPathname.mockReturnValue('/seed-klubben/account')
      render(<BottomTabBar tenantSlug="seed-klubben" showAccount defaultEventId="e9" />)
      expect(tabLink('/seed-klubben/events/e9/schedule')).toBeDefined()
    })

    it('sends the event tabs to the picker when there is no single event', () => {
      mockPathname.mockReturnValue('/seed-klubben/account')
      render(<BottomTabBar tenantSlug="seed-klubben" showAccount defaultEventId={null} />)
      const hrefs = screen.getAllByRole('link').map((el) => el.getAttribute('href'))
      expect(hrefs.filter((h) => h === '/seed-klubben/events')).toHaveLength(4)
      expect(hrefs).toContain('/seed-klubben/account')
    })

    it('lights none of the event tabs while the picker itself is shown', () => {
      mockPathname.mockReturnValue('/seed-klubben/events')
      render(<BottomTabBar tenantSlug="seed-klubben" showAccount defaultEventId={null} />)
      expect(activeHrefs()).toEqual([])
      // One bar, five tabs — duplicate keys used to render the event tabs twice.
      expect(screen.getAllByRole('link')).toHaveLength(5)
    })
  })
})
