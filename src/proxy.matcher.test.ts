import { describe, it, expect } from 'vitest'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { config } from './proxy'

// Own file rather than a block in proxy.test.ts: importing Next's testing
// helpers pulls in server internals that break that file's request-level
// tests (AsyncLocalStorage invariant).
describe('proxy — matcher', () => {
  // N31: browsers fetch the web app manifest without cookies. If the proxy ran
  // on it, a signed-out fetch would be redirected to /login and installing the
  // app to the home screen would silently lose its name and icons.
  it('does not run on /manifest.webmanifest', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/manifest.webmanifest' })).toBe(false)
  })

  it('does not run on the manifest icons', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/icon-512.png' })).toBe(false)
  })

  // Control: proves the helper sees the matcher at all, so the two cases above
  // cannot pass on a config that matches nothing.
  it('control: runs on an app page', () => {
    expect(unstable_doesMiddlewareMatch({ config, url: '/dashboard' })).toBe(true)
  })
})
