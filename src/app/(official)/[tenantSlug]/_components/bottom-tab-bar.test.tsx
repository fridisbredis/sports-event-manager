import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { BottomTabBar } from './bottom-tab-bar'

// The layout test mocks this component away, so which tab is marked active —
// the one thing the bar has to get right — had no coverage. These tests render
// it for real against a given pathname.

const { mockPathname } = vi.hoisted(() => ({ mockPathname: vi.fn() }))

vi.mock('next/navigation', () => ({ usePathname: mockPathname }))

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
  return render(<BottomTabBar tenantSlug="seed-klubben" showAccount={showAccount} />)
}

function activeHrefs() {
  return screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.getAttribute('href'))
}

describe('BottomTabBar', () => {
  it('renders one link per tab', () => {
    renderBar('/seed-klubben/home')

    expect(screen.getAllByRole('link')).toHaveLength(5)
  })

  // ACCT-01 is backed by an `officials` row, and the page answers notFound()
  // without one — so for a role-only admin (a global system_admin holds no
  // roster row in any tenant) the tab is omitted rather than leading to a 404.
  it('omits the account tab when the caller has no officials row', () => {
    renderBar('/seed-klubben/home', false)

    const hrefs = screen.getAllByRole('link').map((el) => el.getAttribute('href'))
    expect(hrefs).toHaveLength(4)
    expect(hrefs).not.toContain('/seed-klubben/account')
  })

  it('marks exactly the tab matching the current path', () => {
    renderBar('/seed-klubben/schedule')

    expect(activeHrefs()).toEqual(['/seed-klubben/schedule'])
  })

  it('marks the parent tab on a nested route', () => {
    renderBar('/seed-klubben/event-info/stage-2')

    expect(activeHrefs()).toEqual(['/seed-klubben/event-info'])
  })

  it('marks no tab on a path outside the bar', () => {
    renderBar('/seed-klubben/something-else')

    expect(activeHrefs()).toEqual([])
  })

  it('does not treat a sibling with a shared prefix as active', () => {
    // '/schedule-archive' starts with '/schedule' as a string but is a
    // different route, so only a '/' boundary may count as nesting.
    renderBar('/seed-klubben/schedule-archive')

    expect(activeHrefs()).toEqual([])
  })

  it('distinguishes the active tab by more than colour alone', () => {
    // Colour is the primary marker, but it must not be the only one — so the
    // active tab's icon also carries a heavier stroke.
    const { container } = renderBar('/seed-klubben/home')

    const strokeWidth = (href: string) =>
      Number(container.querySelector(`a[href="${href}"] svg`)?.getAttribute('stroke-width'))

    expect(strokeWidth('/seed-klubben/home')).toBeGreaterThan(strokeWidth('/seed-klubben/account'))
  })
})
