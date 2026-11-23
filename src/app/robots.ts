import type { MetadataRoute } from 'next'

// N64: only the pages a signed-out visitor can see are open to crawlers. Every
// other route redirects to /login, so there is nothing else to describe, and
// the invite and claim links carry tokens that do not belong in an index.
//
// /_next/static/ and the icons stay open because Google renders a page before
// it describes it; without its CSS and JS, /login would look empty. No sitemap:
// two pages do not need one.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [
        '/login',
        '/privacy',
        '/_next/static/',
        '/favicon.ico',
        '/icon.svg',
        '/apple-icon.png',
      ],
      disallow: '/',
    },
  }
}
