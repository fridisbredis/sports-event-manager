import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import AccountForm from './account-form'

// Returns the i18n key so assertions name the key rather than a translation.
const { fakeT } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: fakeT }) }))

vi.mock('@/lib/hooks/use-unsaved-changes', () => ({
  useUnsavedChanges: () => ({ markDirty: vi.fn(), markClean: vi.fn(), dialogProps: {} }),
}))

vi.mock('@/components/unsaved-changes-dialog', () => ({ default: () => null }))

vi.mock('@/components/ui/app-card', () => ({
  AppCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/form-fields', () => ({
  Input: ({ label, value }: { label?: string; value?: string }) => (
    <label>
      {label}
      <input readOnly value={value ?? ''} />
    </label>
  ),
}))

// Only Switch and Button are reached from this component, but the mock
// replaces the whole module — so Button must be stubbed too, or the shared
// Button wrapper renders `undefined`.
vi.mock('@heroui/react', () => ({
  Switch: ({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) => (
    <button aria-label={ariaLabel} />
  ),
  Button: ({
    children,
    onPress,
    className,
  }: {
    children?: ReactNode
    onPress?: () => void
    className?: string
  }) => (
    <button onClick={onPress} className={className}>
      {children}
    </button>
  ),
}))

const baseProps = {
  name: 'Frida',
  avatarUrl: null,
  phone: '+46709900002',
  smsOptOut: false,
  tenantId: 't1',
  tenantSlug: 'seed-klubben',
  assignmentCount: 3,
  i18nNamespace: 'official' as const,
}

describe('AccountForm log out', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    // jsdom's window.location is not writable; replace just what the button calls.
    vi.stubGlobal('location', { replace: vi.fn() } as unknown as Location)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders a log out control on the official layout', () => {
    render(<AccountForm {...baseProps} />)
    expect(screen.getByText('account.logOut')).toBeTruthy()
  })

  it('signs out through the server route, which owns the cookie jar', async () => {
    render(<AccountForm {...baseProps} />)

    fireEvent.click(screen.getByText('account.logOut'))

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/auth/signout', { method: 'POST' })
    })
    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/login')
    })
  })
})

describe('AccountForm layout split', () => {
  it('keeps the schedule row on the admin layout even with no assignments', () => {
    // It is the admin's only way into their own schedule, so it must not
    // disappear precisely when they want to check that they have no shifts.
    render(<AccountForm {...baseProps} assignmentCount={0} layout="desktop" />)
    expect(screen.queryByText('account.scheduleHeading')).toBeTruthy()
    expect(screen.getByText('account.assignmentCount:{"count":0}')).toBeTruthy()
  })

  it('shows the schedule row only on the admin (desktop) layout', () => {
    // The admin sidebar has no link to the admin's own shifts, so the account
    // screen carries it. An official reaches theirs from the bottom tab bar.
    const { unmount } = render(<AccountForm {...baseProps} layout="desktop" />)
    expect(screen.queryByText('account.scheduleHeading')).toBeTruthy()
    unmount()

    render(<AccountForm {...baseProps} />)
    expect(screen.queryByText('account.scheduleHeading')).toBeNull()
  })

  it('shows log out only on the official (mobile) layout', () => {
    // The admin layout already carries one at the foot of its sidebar.
    const { unmount } = render(<AccountForm {...baseProps} layout="desktop" />)
    expect(screen.queryByText('account.logOut')).toBeNull()
    unmount()

    render(<AccountForm {...baseProps} />)
    expect(screen.queryByText('account.logOut')).toBeTruthy()
  })
})
