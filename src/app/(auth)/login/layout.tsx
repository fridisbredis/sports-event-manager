import type { Metadata } from 'next'

// N64: the page itself is a client component and cannot export metadata, so it
// lives here. Search results and AI summaries had only the root title to go on
// and guessed this was a participant or race-results portal.
//
// English only: /login is reached signed out, and a signed-out visitor always
// gets the default locale. Tenant-neutral: several tenants sign in on the same
// domain.
export const metadata: Metadata = {
  title: 'Sign in for event organisers and officials — Sports Event Manager',
  description:
    'Staff sign-in for planning and staffing sport events: organisers and officials. ' +
    'Not a participant or race-results portal.',
  robots: { index: true, follow: true },
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
