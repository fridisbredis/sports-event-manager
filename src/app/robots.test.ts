import { describe, it, expect } from 'vitest'
import robots from './robots'

// N64: only the two pages a signed-out visitor can see are open to crawlers.
// Everything else redirects to /login anyway, and must not be guessed at.
describe('robots.txt', () => {
  const rules = robots().rules
  const rule = Array.isArray(rules) ? rules[0] : rules

  it('applies to every crawler', () => {
    expect(rule.userAgent).toBe('*')
  })

  it('allows the sign-in page and the privacy policy', () => {
    expect(rule.allow).toEqual(expect.arrayContaining(['/login', '/privacy']))
  })

  // Google renders a page before describing it; blocking its CSS and JS would
  // make /login look empty to the crawler.
  it('allows the static assets /login needs to render', () => {
    expect(rule.allow).toEqual(expect.arrayContaining(['/_next/static/']))
  })

  it('disallows everything else', () => {
    expect(rule.disallow).toBe('/')
  })

  it('names no sitemap', () => {
    expect(robots().sitemap).toBeUndefined()
  })
})
