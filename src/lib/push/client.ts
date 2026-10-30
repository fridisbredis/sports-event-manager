// N31: browser-side Web Push helpers. Push is sent in addition to SMS, never
// instead of it, so every failure here is survivable: the user still gets the
// SMS.

const SW_URL = '/sw.js'
const ENDPOINT = '/api/account/push-subscription'

export type PushSupport =
  // Can subscribe right here.
  | 'supported'
  // iOS/iPadOS in a Safari tab: push only exists once the app is added to the
  // home screen and opened from that icon (iOS 16.4+).
  | 'needs-install'
  // No Push API at all (old browser, in-app webview, iOS < 16.4).
  | 'unsupported'

function isIos(): boolean {
  // iPadOS 13+ reports itself as a Mac; the touch check tells them apart.
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function getPushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (hasApi) return 'supported'
  // On iOS a Safari tab has no PushManager at all, so "missing API" there
  // usually means "not installed yet" rather than "can never work".
  if (isIos() && !isStandalone()) return 'needs-install'
  return 'unsupported'
}

// The VAPID public key is base64url; PushManager wants raw bytes.
function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = window.atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
  return bytes
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration(SW_URL)
  return registration ? registration.pushManager.getSubscription() : null
}

// Whether THIS device currently has a live subscription. The server row may
// lag behind (e.g. the push service expired it); the sender cleans those up.
export async function isPushEnabledHere(): Promise<boolean> {
  if (getPushSupport() !== 'supported') return false
  if (Notification.permission !== 'granted') return false
  return (await existingSubscription()) !== null
}

export type EnableResult = 'enabled' | 'denied' | 'failed'

// Must be called directly from a click handler: the permission prompt only
// appears for a user gesture, and on iOS any await before requestPermission()
// is enough to lose it.
export async function enablePush(vapidPublicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'

  try {
    const registration = await navigator.serviceWorker.register(SW_URL)
    await navigator.serviceWorker.ready

    // Always replace a subscription the browser already holds. On a shared
    // device it may belong to whoever was signed in before, and their server
    // row would keep routing THEIR announcements here. Unsubscribing kills
    // that endpoint at the push service, so the old row stops delivering and
    // is removed by the sender on its first 404/410.
    const previous = await registration.pushManager.getSubscription()
    if (previous) await previous.unsubscribe()

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(vapidPublicKey),
    })

    const response = await fetch(ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription.toJSON()),
    })

    if (!response.ok) {
      // Don't leave a browser subscription the server knows nothing about.
      await subscription.unsubscribe()
      return 'failed'
    }

    return 'enabled'
  } catch {
    return 'failed'
  }
}

// Removes this device's row and its browser subscription. Server first: if the
// row delete fails, the browser subscription is still killed, which stops
// delivery anyway (the push service rejects the dead endpoint).
export async function disablePush(): Promise<void> {
  const subscription = await existingSubscription()
  if (!subscription) return

  try {
    await fetch(ENDPOINT, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    })
  } finally {
    await subscription.unsubscribe()
  }
}

// Logout must never hang or fail because of push, so this is best-effort and
// time-boxed. Without it, the next person to sign in on a shared device would
// receive the previous user's announcements.
export async function forgetPushOnLogout(timeoutMs = 2000): Promise<void> {
  if (getPushSupport() !== 'supported') return
  await Promise.race([
    disablePush().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}
