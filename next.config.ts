import type { NextConfig } from 'next'
import path from 'path'
import { withSentryConfig } from '@sentry/nextjs'

const nextConfig: NextConfig = {
  output: 'standalone', // required for Docker
  // Pin the workspace root — an unrelated package-lock.json in a parent
  // directory (outside this repo) otherwise makes Next.js infer the wrong root.
  turbopack: {
    root: path.join(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      // The local Supabase stack serves Storage over plain http on
      // 127.0.0.1:54321, which matches neither the protocol nor the hostname
      // above — so tenant logos and avatars throw "Invalid src prop" and take
      // the whole page down via the error boundary. Dev and prod are unaffected
      // (they use *.supabase.co over https); this entry only ever matches when
      // NEXT_PUBLIC_SUPABASE_URL points at the local stack.
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '54321',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    // Next 16 added an SSRF guard that rejects any upstream image whose
    // hostname resolves to a private IP — a second, independent check after
    // remotePatterns, with the same '"url" parameter is not allowed' 400. The
    // local Supabase stack is on 127.0.0.1, so local logos and avatars are
    // blocked by it even though the pattern above matches them.
    //
    // Gated on the Supabase URL actually being local rather than on NODE_ENV:
    // `next build` runs with NODE_ENV=production, so an env check would leave
    // this on in the Docker image. Dev and prod point at https://*.supabase.co,
    // so this evaluates to false there and the SSRF guard stays armed.
    dangerouslyAllowLocalIP: /\/\/(127\.0\.0\.1|localhost)[:/]/.test(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
    ),
  },
}

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Only meaningful with SENTRY_AUTH_TOKEN set (CI); silently no-ops locally.
  silent: true,
  widenClientFileUpload: true,
  // Routes browser Sentry requests through our own domain, avoiding ad-blockers.
  tunnelRoute: '/monitoring',
})
