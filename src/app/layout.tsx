import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sports Event Manager',
  description: 'Plan and execute your sport event',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
