import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildAppLink } from './app-link'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('buildAppLink', () => {
  it('joins the configured origin and the path', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')

    expect(buildAppLink('/invite/tok-1')).toBe('https://app.example.com/invite/tok-1')
  })

  it('does not double the slash when the origin has a trailing one', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/')

    expect(buildAppLink('/invite/tok-1')).toBe('https://app.example.com/invite/tok-1')
  })

  it('tolerates a path given without a leading slash', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')

    expect(buildAppLink('invite/tok-1')).toBe('https://app.example.com/invite/tok-1')
  })

  // B9. Without this the invite SMS reads "...Confirm within 7 days:
  // undefined/invite/<uuid>" — a message that has already cost a segment and
  // can never work. Returning null is what lets every caller skip the send.
  it.each([
    ['unset', undefined],
    ['empty', ''],
    ['not absolute', '/app'],
    ['not https', 'http://app.example.com'],
    ['the literal string undefined', 'undefined'],
  ])('returns null when the origin is %s', (_label, value) => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', value as string)

    expect(buildAppLink('/invite/tok-1')).toBeNull()
  })
})
