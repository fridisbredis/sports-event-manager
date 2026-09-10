import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import { spawnSync } from 'node:child_process'
import { config as loadEnv } from 'dotenv'

// E2E runs against the LOCAL stack only. The seed users and their fixed OTP
// codes exist solely in supabase/config.toml [auth.sms.test_otp], so pointing
// this at dev or prod would both fail to log in and touch real data.
loadEnv({ path: path.resolve(__dirname, '.env.local.e2e'), override: false })

const BASE_URL = process.env.E2E_LOCAL_URL ?? 'http://localhost:3000'

// Refuse to run against anything but localhost. Mirrors the loopback interlock
// in tests/integration/setup-env.ts — the suite signs in as seeded users and
// writes through the UI, which must never happen against a shared environment.
const host = new URL(BASE_URL).hostname
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(
    `E2E refuses to run against ${BASE_URL}. This suite signs in as seeded test users ` +
      'and writes through the UI; it is local-only by design. Set E2E_LOCAL_URL to a ' +
      'localhost URL, or run the integration suite instead.'
  )
}

export default defineConfig({
  testDir: './tests/e2e',
  // Admin screens are desktop-first, official screens mobile-first (DECISION
  // 2026-06-24). Specs opt into a viewport via test.use() rather than running
  // the whole suite through two projects, which would double the runtime for
  // no signal on screens that only exist in one form factor.
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The app is English-only in v1 (defaultLocale 'en', sv/auth.json absent),
    // so selectors match English labels. Pinning the locale keeps that true
    // regardless of the developer's machine, and keeps guessPhoneCountryFromLocale
    // landing on its SE default for the +46 seed numbers.
    locale: 'en-GB',
    timezoneId: 'Europe/Stockholm',
  },

  // Every worker competes for the same seeded users and the same GoTrue
  // rate limits (sms_sent = 30/h, token_verifications = 30/5min). Signing in
  // is amortized by storageState reuse in tests/e2e/fixtures/auth.ts, but
  // parallel workers still mutate one shared tenant's data, so writes would
  // race. Serial by default; CI keeps a single worker for reproducibility.
  workers: 1,
  fullyParallel: false,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  globalSetup: './tests/e2e/global-setup.ts',

  expect: {
    // Server Components + router.refresh() round-trips are slower than a
    // client-only app; the default 5s produces flakes on cold Next.js routes.
    timeout: 10_000,
  },
  timeout: 60_000,

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Dev server, never a prebuilt bundle: NEXT_PUBLIC_* is inlined at build
  // time, so a .next built against dev-cloud would silently authenticate
  // against the wrong Supabase project (DEVELOPMENT.md documents this trap).
  //
  // The env below is the other half of that trap. .env.local ships with the
  // dev *cloud* URL active and the local one commented out, so a plain
  // `npm run dev` authenticates against dev — where the seed users also exist,
  // so the suite would appear to pass while writing into a shared project.
  // Overriding here (Next.js gives process.env precedence over .env.local)
  // pins the dev server to the local stack without editing a tracked file.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: localSupabaseEnv(),
  },
})

// Reads the running local stack's URL and keys, the same way
// scripts/seed-dev-local.mjs does.
function localSupabaseEnv(): Record<string, string> {
  const status = spawnSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (status.error || status.status !== 0) {
    throw new Error(
      'Local Supabase stack is not running. Start it first:\n' +
        '  export SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=dummy\n' +
        '  supabase start'
    )
  }

  const parsed = JSON.parse(status.stdout) as Record<string, string | undefined>
  const url = parsed.API_URL
  const anonKey = parsed.ANON_KEY
  const serviceRoleKey = parsed.SERVICE_ROLE_KEY

  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Could not read local Supabase credentials from 'supabase status -o json'.")
  }

  return {
    ...(process.env as Record<string, string>),
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  }
}
