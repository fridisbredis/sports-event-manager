import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone', // required for Docker
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

export default nextConfig
