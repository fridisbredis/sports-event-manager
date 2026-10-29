import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { enablePush, forgetPushOnLogout, getPushSupport } from './client'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'

// jsdom has neither the Push API nor service workers, so each test installs
// exactly the pieces it needs and this removes them again.
function installPushApi({
  permission = 'granted' as NotificationPermission,
  previous = null as { unsubscribe: () => Promise<boolean> } | null,
} = {}) {
  const subscription = {
    endpoint: 'https://push.example/new',
    toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  const pushManager = {
    getSubscription: vi.fn().mockResolvedValue(previous),
    subscribe: vi.fn().mockResolvedValue(subscription),
  }
  const registration = { pushManager }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: vi.fn().mockResolvedValue(registration),
      ready: Promise.resolve(registration),
      getRegistration: vi.fn().mockResolvedValue(registration),
    },
  })
  vi.stubGlobal('PushManager', function PushManager() {})
  vi.stubGlobal(
    'Notification',
    Object.assign(function Notification() {}, {
      permission,
      requestPermission: vi.fn().mockResolvedValue(permission),
    })
  )
  return { subscription, pushManager }
}

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
  setUserAgent('Mozilla/5.0 (jsdom)')
  vi.useRealTimers()
})

describe('getPushSupport', () => {
  it('is supported when the Push API is present', () => {
    installPushApi()
    expect(getPushSupport()).toBe('supported')
  })

  // A Safari tab on iPhone has no PushManager: the fix is installing the app,
  // not a different browser, and the UI has to say so.
  it('asks an iPhone Safari tab to install first', () => {
    setUserAgent(IPHONE_UA)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(getPushSupport()).toBe('needs-install')
  })

  // Already installed but still no Push API means iOS older than 16.4:
  // installing again would not help, so it must not be told to.
  it('is unsupported on an installed iPhone app without the API', () => {
    setUserAgent(IPHONE_UA)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    expect(getPushSupport()).toBe('unsupported')
  })

  it('is unsupported on a non-iOS browser without the API', () => {
    expect(getPushSupport()).toBe('unsupported')
  })
})

describe('enablePush', () => {
  it('returns denied and registers nothing when permission is refused', async () => {
    installPushApi({ permission: 'denied' })

    expect(await enablePush('BAAA')).toBe('denied')
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  // Shared device: the subscription the browser already holds may belong to
  // whoever signed in before. It has to be killed, not reused, or their
  // announcements keep arriving here.
  it('replaces a subscription the browser already holds rather than reusing it', async () => {
    const previous = { unsubscribe: vi.fn().mockResolvedValue(true) }
    const { pushManager } = installPushApi({ previous })

    expect(await enablePush('BAAA')).toBe('enabled')
    expect(previous.unsubscribe).toHaveBeenCalled()
    expect(previous.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(
      pushManager.subscribe.mock.invocationCallOrder[0]
    )
  })

  it('registers the new subscription with the server', async () => {
    installPushApi()

    await enablePush('BAAA')

    expect(fetch).toHaveBeenCalledWith(
      '/api/account/push-subscription',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('drops the browser subscription again when the server refuses it', async () => {
    const { subscription } = installPushApi()
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response)

    expect(await enablePush('BAAA')).toBe('failed')
    expect(subscription.unsubscribe).toHaveBeenCalled()
  })
})

describe('forgetPushOnLogout', () => {
  // Logout must never hang on push: a stalled DELETE gives up after the
  // timeout and the sign-out proceeds.
  it('resolves after the timeout even if the server never answers', async () => {
    vi.useFakeTimers()
    installPushApi({ previous: { unsubscribe: vi.fn().mockResolvedValue(true) } })
    vi.mocked(fetch).mockReturnValue(new Promise(() => {}))

    let done = false
    const pending = forgetPushOnLogout(2000).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(2000)
    await pending

    expect(done).toBe(true)
  })

  it('does nothing where push is unsupported', async () => {
    await forgetPushOnLogout()
    expect(fetch).not.toHaveBeenCalled()
  })
})
