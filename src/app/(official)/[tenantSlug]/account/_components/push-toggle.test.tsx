import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PushToggle } from './push-toggle'

// Returns the i18n key so assertions name the key rather than a translation.
vi.mock('@/lib/i18n/client', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toastError }))

vi.mock('@heroui/react', () => ({
  Switch: ({
    'aria-label': ariaLabel,
    isSelected,
    isDisabled,
    onValueChange,
  }: {
    'aria-label'?: string
    isSelected?: boolean
    isDisabled?: boolean
    onValueChange?: (v: boolean) => void
  }) => (
    <button
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      disabled={isDisabled}
      onClick={() => onValueChange?.(!isSelected)}
    />
  ),
}))

const push = vi.hoisted(() => ({
  getPushSupport: vi.fn(),
  isPushEnabledHere: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}))
vi.mock('@/lib/push/client', () => push)

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('Notification', { permission: 'default' })
  push.isPushEnabledHere.mockResolvedValue(false)
})

describe('PushToggle', () => {
  it('shows the install hint, and no switch, in an iPhone Safari tab', async () => {
    push.getPushSupport.mockReturnValue('needs-install')

    render(<PushToggle vapidPublicKey="BAAA" />)

    expect(await screen.findByText('account.pushHintInstallIos')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('says SMS still arrives where push is unsupported', async () => {
    push.getPushSupport.mockReturnValue('unsupported')

    render(<PushToggle vapidPublicKey="BAAA" />)

    expect(await screen.findByText('account.pushHintUnsupported')).toBeTruthy()
  })

  it('enables push on toggle and reflects it', async () => {
    push.getPushSupport.mockReturnValue('supported')
    push.enablePush.mockResolvedValue('enabled')

    render(<PushToggle vapidPublicKey="BAAA" />)
    fireEvent.click(await screen.findByRole('button', { name: 'account.pushLabel' }))

    expect(push.enablePush).toHaveBeenCalledWith('BAAA')
    expect(await screen.findByText('account.pushHintOn')).toBeTruthy()
  })

  it('toasts and stays off when permission is refused', async () => {
    push.getPushSupport.mockReturnValue('supported')
    push.enablePush.mockResolvedValue('denied')

    render(<PushToggle vapidPublicKey="BAAA" />)
    fireEvent.click(await screen.findByRole('button', { name: 'account.pushLabel' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('account.pushDenied'))
    expect(screen.getByText('account.pushHintOff')).toBeTruthy()
  })

  // A permission blocked in browser settings cannot be re-asked from the page;
  // the switch would do nothing, so it is disabled and the hint explains why.
  it('disables the switch when notifications are blocked', async () => {
    push.getPushSupport.mockReturnValue('supported')
    vi.stubGlobal('Notification', { permission: 'denied' })

    render(<PushToggle vapidPublicKey="BAAA" />)

    expect(await screen.findByText('account.pushHintBlocked')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'account.pushLabel' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('disables push on toggle off', async () => {
    push.getPushSupport.mockReturnValue('supported')
    push.isPushEnabledHere.mockResolvedValue(true)
    push.disablePush.mockResolvedValue(undefined)

    render(<PushToggle vapidPublicKey="BAAA" />)
    await screen.findByText('account.pushHintOn')
    fireEvent.click(screen.getByRole('button', { name: 'account.pushLabel' }))

    expect(push.disablePush).toHaveBeenCalled()
    expect(await screen.findByText('account.pushHintOff')).toBeTruthy()
  })
})
