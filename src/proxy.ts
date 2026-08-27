import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const { pathname } = request.nextUrl

  // Health check paths are exempt from auth — Azure probes hit these with
  // no Supabase session cookie. Kept as an explicit list of exact paths,
  // not a startsWith prefix, so a future /api/health/* route doesn't
  // become publicly reachable without anyone deciding it should be. Add
  // any new health path here explicitly rather than widening this to a
  // prefix match.
  //
  // Deliberately checked before createServerClient() is constructed below:
  // that constructor throws on a missing/malformed NEXT_PUBLIC_SUPABASE_*
  // env var, and this path must never fail for a reason external to the
  // app itself — that's the exact restart-loop failure mode
  // /api/health/live exists to prevent. Do not move this below the
  // Supabase client setup.
  if (pathname === '/api/health' || pathname === '/api/health/live') {
    return supabaseResponse
  }

  // Cron routes are called by pg_cron/pg_net (migration 0029), never by a
  // browser — they have no Supabase session cookie and authenticate via
  // CRON_SECRET inside the route handler itself instead. Checked before
  // createServerClient() for the same reason as the health block above.
  if (pathname.startsWith('/api/cron/')) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session — required for @supabase/ssr, do not remove. Health
  // and cron paths return above and never reach this call: both are
  // machine-called (Azure probes, pg_cron/pg_net) and have no session to
  // refresh, so skipping it for them is safe.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && pathname !== '/login' && !pathname.startsWith('/invite/')) {
    // For API routes, return 401 JSON instead of redirecting to login HTML
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Logged-in users have no business on the login page — send them to role routing
  if (user && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
