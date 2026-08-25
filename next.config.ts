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
    ],
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
