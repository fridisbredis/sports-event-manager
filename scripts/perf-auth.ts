// Authenticated cookie jars for the PERF-01 measurement harness.
//
// The harness measures Next.js server-rendered read paths over HTTP, so it
// needs the same session cookies a browser would carry. Two design choices are
// load-bearing:
//
// 1. **Password sign-in, not OTP.** The app itself is phone-OTP only, and
//    `supabase/config.toml` lists fixed test OTPs for +46700000001-010 — but
//    the perf seed deliberately uses a disjoint pool (+4672000xxxx, see
//    perf-env.ts), so none of its ~90 users can receive a test OTP. Setting a
//    password via the admin API and calling signInWithPassword sidesteps
//    test_otp entirely: no config.toml edit, no `supabase stop/start`, and it
//    scales to any number of users. The app never uses passwords, so this
//    touches nothing production-facing.
//
// 2. **Cookies come from @supabase/ssr, never reconstructed.** src/lib/supabase/
//    server.ts is a plain createServerClient with no custom cookie names or
//    storage key, so it reads whatever @supabase/ssr writes — including the
//    chunking it applies to large values. Rather than guessing the cookie name
//    (`sb-<ref>-auth-token`, chunked `.0`/`.1`/…), we run the sign-in *through*
//    a server client whose setAll writes into our own in-memory jar. The exact
//    names, values and chunk boundaries the app will later read come straight
//    from the library.
//
// Rate limits to respect (config.toml [auth.rate_limit]): token_verifications
// and sign_in_sign_ups are both 30 per 5 minutes per IP. Sign in ONCE per user
// and reuse the jar — never per iteration.

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { loadPerfEnv } from './perf-env'

// Local-only, and only ever set on seeded users in the perf phone pool.
const HARNESS_PASSWORD = 'perf-harness-local-only-pw'

type Cookie = { name: string; value: string; options?: CookieOptions }

/**
 * A cookie jar shaped for `fetch`: collects what @supabase/ssr writes and
 * serialises it back into a Cookie request header.
 */
export class CookieJar {
  private jar = new Map<string, string>()

  setAll(cookies: Cookie[]) {
    for (const { name, value } of cookies) {
      // An empty value is @supabase/ssr clearing a chunk it no longer needs.
      if (value === '') this.jar.delete(name)
      else this.jar.set(name, value)
    }
  }

  getAll(): Array<{ name: string; value: string }> {
    return [...this.jar.entries()].map(([name, value]) => ({ name, value }))
  }

  get header(): string {
    return [...this.jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ')
  }

  get isEmpty(): boolean {
    return this.jar.size === 0
  }
}

/** The local stack's anon key, needed for the sign-in client. */
function anonKey(): string {
  const key = process.env.PERF_SUPABASE_ANON_KEY
  if (!key) {
    throw new Error(
      '.env.perf must define PERF_SUPABASE_ANON_KEY for the measurement harness. ' +
        "See .env.perf.example — it is the Supabase CLI's fixed local anon key."
    )
  }
  return key
}

/**
 * Gives a seeded user a known password so the harness can sign in as them.
 * Idempotent: safe to call for a user who already has one.
 */
export async function grantHarnessPassword(phoneE164: string): Promise<void> {
  const { url, serviceRoleKey } = loadPerfEnv()
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // auth.users stores the phone without the leading '+', matching
  // normalizePhoneToE164's storage shape (see seed-perf.ts).
  const stored = phoneE164.replace(/^\+/, '')

  let page = 1
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw error

    const user = data.users.find((u) => u.phone === stored)
    if (user) {
      const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
        password: HARNESS_PASSWORD,
      })
      if (updateError) {
        throw new Error(`Could not set harness password for ${phoneE164}: ${updateError.message}`)
      }
      return
    }

    if (data.users.length < 1000) break
    page += 1
  }

  throw new Error(
    `No auth user for ${phoneE164}. Run 'npm run seed:perf' first — the harness signs in as ` +
      'the users that seed creates.'
  )
}

/**
 * Signs in as a seeded user and returns a jar holding exactly the cookies the
 * app's own server client will read.
 */
export async function signInToJar(phoneE164: string): Promise<CookieJar> {
  const { url } = loadPerfEnv()
  const jar = new CookieJar()

  const client = createServerClient<Database>(url, anonKey(), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies) => jar.setAll(cookies),
    },
  })

  const { error } = await client.auth.signInWithPassword({
    phone: phoneE164,
    password: HARNESS_PASSWORD,
  })

  if (error) {
    throw new Error(
      `Sign-in failed for ${phoneE164}: ${error.message}\n` +
        'If this is "Invalid login credentials", call grantHarnessPassword() for this user first.'
    )
  }

  if (jar.isEmpty) {
    throw new Error(
      `Sign-in for ${phoneE164} reported success but wrote no cookies. The @supabase/ssr ` +
        'cookie contract may have changed — the harness cannot proceed without them.'
    )
  }

  return jar
}
