import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import type { ReactNode } from 'react'
import AccountForm from './account-form'

// Returns the i18n key so assertions name the key rather than a translation.
const { fakeT } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: fakeT }) }))

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toastError }))

// This file tests the account form's own behaviour, and the real switcher
// pulls in useRouter(), which has no mounted app router under jsdom.
vi.mock('@/components/language-switcher', () => ({ LanguageSwitcher: () => null }))

vi.mock('@/components/ui/app-card', () => ({
  AppCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/form-fields', () => ({
  Input: ({
    label,
    value,
    onValueChange,
    onBlur,
  }: {
    label?: string
    value?: string
    onValueChange?: (v: string) => void
    onBlur?: () => void
  }) => (
    <label>
      {label}
      <input
        value={value ?? ''}
        onChange={(e) => onValueChange?.(e.target.value)}
        onBlur={onBlur}
      />
    </label>
  ),
}))

// Only Switch is reached from this component now that the Save button is
// gone, but the mock replaces the whole module, so Button is stubbed too for
// anything that reaches it indirectly.
vi.mock('@heroui/react', () => ({
  Switch: ({
    'aria-label': ariaLabel,
    isSelected,
    onValueChange,
  }: {
    'aria-label'?: string
    isSelected?: boolean
    onValueChange?: (v: boolean) => void
  }) => <button aria-label={ariaLabel} onClick={() => onValueChange?.(!isSelected)} />,
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
  language: 'en' as const,
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

  it('links the privacy policy from both layouts', () => {
    // Unlike the two rows above, this one is not a layout split: it is the
    // only route to the policy from inside the app for either role, so a
    // future refactor must not quietly drop it from one of them.
    for (const layout of ['desktop', undefined] as const) {
      const { unmount } = render(<AccountForm {...baseProps} layout={layout} />)
      const link = screen.getByText('account.privacyPolicy').closest('a')
      expect(link?.getAttribute('href')).toBe('/privacy')
      // Opening in a tab of its own is what keeps an unsaved field intact.
      expect(link?.getAttribute('target')).toBe('_blank')
      expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
      unmount()
    }
  })
})

describe('AccountForm autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('offers no Save control — the form writes on its own', () => {
    render(<AccountForm {...baseProps} />)
    expect(screen.queryByText('account.save')).toBeNull()
  })

  it('writes the name once the typing settles', async () => {
    render(<AccountForm {...baseProps} />)
    const input = screen.getByLabelText('account.nameLabel')

    fireEvent.change(input, { target: { value: 'Frida B' } })
    expect(fetch).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/account')
    expect(JSON.parse(init.body)).toEqual({
      tenantId: 't1',
      name: 'Frida B',
      smsOptOut: false,
    })
  })

  it('collapses a burst of keystrokes into one request', async () => {
    render(<AccountForm {...baseProps} />)
    const input = screen.getByLabelText('account.nameLabel')

    fireEvent.change(input, { target: { value: 'F' } })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.change(input, { target: { value: 'Fr' } })
    act(() => vi.advanceTimersByTime(300))
    fireEvent.change(input, { target: { value: 'Fri' } })

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(init.body).name).toBe('Fri')
  })

  it('writes on blur rather than making the user wait out the delay', async () => {
    render(<AccountForm {...baseProps} />)
    const input = screen.getByLabelText('account.nameLabel')

    fireEvent.change(input, { target: { value: 'Frida B' } })
    await act(async () => {
      fireEvent.blur(input)
    })

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('writes the switch immediately — there is no half-flipped state to wait for', async () => {
    render(<AccountForm {...baseProps} />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('account.smsUpdatesLabel'))
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    // The route validates both fields together, so the untouched name rides
    // along with the toggle rather than being dropped.
    expect(JSON.parse(init.body)).toEqual({
      tenantId: 't1',
      name: 'Frida',
      smsOptOut: true,
    })
  })

  it('does not write an empty name, and restores the stored one on blur', async () => {
    render(<AccountForm {...baseProps} />)
    const input = screen.getByLabelText('account.nameLabel')

    fireEvent.change(input, { target: { value: '' } })
    await act(async () => {
      vi.advanceTimersByTime(800)
    })
    // min(1) on the route would reject it; the user is mid-edit, not done.
    expect(fetch).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.blur(input)
    })
    expect((input as HTMLInputElement).value).toBe('Frida')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not write a name that is already what is stored', async () => {
    render(<AccountForm {...baseProps} />)
    const input = screen.getByLabelText('account.nameLabel')

    fireEvent.change(input, { target: { value: 'Fridaa' } })
    fireEvent.change(input, { target: { value: 'Frida' } })

    await act(async () => {
      vi.advanceTimersByTime(800)
    })

    expect(fetch).not.toHaveBeenCalled()
  })

  it('surfaces a failed write instead of silently dropping it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<AccountForm {...baseProps} />)

    await act(async () => {
      fireEvent.click(screen.getByLabelText('account.smsUpdatesLabel'))
    })

    // Both halves matter: the toast is what catches the eye, the status line
    // is what remains readable afterwards.
    expect(toastError).toHaveBeenCalledWith('account.saveError')
    expect(screen.getByText('account.saveError')).toBeTruthy()
  })
})
