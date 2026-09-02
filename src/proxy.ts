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

  // F-SEC-08: these routes ARE the login flow (send/verify OTP) — by
  // definition there is no session yet when they're called, so they can't
  // require one. Their own rate limiting (checkLoginSendRateLimit/
  // checkLoginVerifyRateLimit) is the abuse guard here, not this middleware.
  // Exact paths, not a prefix, for the same reason as the health block above.
  if (pathname === '/api/auth/send-otp' || pathname === '/api/auth/verify-otp') {
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

  // Establishes the session AND refreshes it — both still required for
  // @supabase/ssr, do not remove. Health and cron paths return above and never
  // reach this call: both are machine-called (Azure probes, pg_cron/pg_net) and
  // have no session to refresh, so skipping it for them is safe.
  //
  // getClaims() rather than getUser(): it verifies the JWT signature locally
  // against the project's ES256 signing keys instead of asking GoTrue, which
  // PERF-01 measured at 130 ms p50 under load versus 3 ms. The session refresh
  // this comment has always insisted on is preserved — getClaims() refreshes a
  // near-expiry token before validating it, and the setAll cookie writer above
  // is what persists the rotated cookie either way. It also falls back to the
  // same server call getUser() makes if a project is ever on a symmetric
  // secret, so this is a speed change, not a security one.
  //
  // getClaims() can throw instead of returning { error } — a token whose
  // segments are valid base64url but decode to non-JSON makes JSON.parse
  // throw a plain Error, which isAuthError() doesn't recognise. An
  // unparseable cookie (a forged token, or a truncated @supabase/ssr chunk)
  // must read as "no session", not crash the whole request.
  const { data: claimsData } = await supabase.auth.getClaims().catch(() => ({ data: null }))
  const user = claimsData?.claims?.sub ? { id: claimsData.claims.sub } : null

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
