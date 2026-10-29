// N31: service worker for Web Push. Plain JS in public/ so it is served as-is
// at /sw.js — a service worker's scope is its own path, and only a script at
// the root can control the whole app.
//
// Deliberately does nothing else: no fetch handler, no offline cache. A fetch
// handler would sit in front of every request the app makes, and stale cached
// pages are a worse failure than a network error for an app whose data changes
// during an event.
//
// The proxy matcher excludes this file (src/proxy.ts): a redirect to /login
// on the script fetch makes registration fail.

self.addEventListener('install', () => {
  // Take over as soon as installed rather than waiting for every open tab to
  // close — there is no cache to migrate, so there is nothing to wait for.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// Payload shape sent by the server: { title, body, url }. Every field is
// optional so a malformed or empty push still shows something rather than
// nothing — on iOS, a push that shows no notification counts against the
// site and can get its permission revoked.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Sports Event Manager'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // Same-origin only: the url comes from our own server, but a notification is
  // the wrong place to be able to send someone off-site.
  const target = new URL(event.notification.data?.url || '/', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // Reuse an open window of the app rather than stacking a new one.
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(url)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    })
  )
})
