import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SidebarNav } from './sidebar-nav'

// N67: the support items fold into one row. The layout test mocks this
// component away, so these render it for real against a given pathname.
// Only the desktop rail is in the DOM: the drawer renders nothing until opened.

const { mockPathname, mockParams } = vi.hoisted(() => ({
  mockPathname: vi.fn(),
  mockParams: vi.fn(
    () => ({ tenantSlug: 'seed-klubben', eventId: 'e1' }) as Record<string, string>
  ),
}))

vi.mock('next/navigation', () => ({
  usePathname: mockPathname,
  useParams: mockParams,
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

// The real one pulls in the push client; only its place in the group matters.
vi.mock('@/components/logout-button', () => ({
  LogoutButton: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}))

function renderNav(pathname: string, { showAccount = true, showSystemAdmin = true } = {}) {
  mockPathname.mockReturnValue(pathname)
  return render(
    <SidebarNav
      tenantSlug="seed-klubben"
      adminLabel="Admin"
      showAccount={showAccount}
      showParticipants
      showSystemAdmin={showSystemAdmin}
      otherTenants={[]}
    />
  )
}

const toggle = () => screen.getByRole('button', { name: /navigation\.supportMenu/ })

// Labels of the visible rows in the group, in order. Hidden rows are left out
// by getAllByRole, which is what a user (and a screen reader) gets.
function groupRows() {
  const group = document.getElementById(toggle().getAttribute('aria-controls')!)!
  if (group.hidden) return []
  return Array.from(group.querySelectorAll('a, button')).map((el) => el.textContent)
}

describe('SidebarNav support group (N67)', () => {
  it('starts collapsed on an ordinary page', () => {
    renderNav('/seed-klubben/admin/events/e1/dashboard')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('link', { name: 'navigation.account' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'navigation.logOut' })).toBeNull()
  })

  it('expands with Account on top, and collapses again', () => {
    renderNav('/seed-klubben/admin/events/e1/dashboard')
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(groupRows()).toEqual([
      'navigation.account',
      'navigation.helpGuide',
      'navigation.officialView',
      'navigation.systemAdminView',
      'navigation.logOut',
    ])
    fireEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(groupRows()).toEqual([])
  })

  it('leaves out System admin and Account when the caller has neither', () => {
    renderNav('/seed-klubben/admin/events/e1/dashboard', {
      showAccount: false,
      showSystemAdmin: false,
    })
    fireEvent.click(toggle())
    expect(groupRows()).toEqual([
      'navigation.helpGuide',
      'navigation.officialView',
      'navigation.logOut',
    ])
  })

  it.each([
    ['Account', '/seed-klubben/admin/account', 'navigation.account'],
    ['Help and guide', '/seed-klubben/admin/events/e1/help', 'navigation.helpGuide'],
  ])('opens expanded on %s with the item highlighted', (_, pathname, label) => {
    renderNav(pathname)
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
  })

  it('opens when client navigation lands on a support page', () => {
    const { rerender } = renderNav('/seed-klubben/admin/events/e1/dashboard')
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    mockPathname.mockReturnValue('/seed-klubben/admin/account')
    rerender(
      <SidebarNav
        tenantSlug="seed-klubben"
        adminLabel="Admin"
        showAccount
        showParticipants
        showSystemAdmin
        otherTenants={[]}
      />
    )
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
  })
})
