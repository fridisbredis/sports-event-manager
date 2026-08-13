import { config } from 'dotenv'
import path from 'path'

// .env.test.local is written from `supabase status -o env` with
// `--override-name` flags (see .github/workflows/quality.yml) so it carries
// exactly SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.
// Application code under src/ reads the NEXT_PUBLIC_ name, so tests that
// call into src/ need the alias — see below.
const envPath = path.resolve(import.meta.dirname, '../../.env.test.local')

const result = config({ path: envPath, override: true })

if (result.error) {
  throw new Error(
    `Failed to load ${envPath}: ${result.error.message}\n` +
      'Generate it locally with `supabase status -o env --override-name api.url=SUPABASE_URL ' +
      '--override-name auth.anon_key=SUPABASE_ANON_KEY ' +
      '--override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY` ' +
      'against a running local Supabase stack (`supabase start`).'
  )
}

// Never write the literal string 'undefined' — `??=` on process.env coerces
// the right-hand side with String(), so a missing source variable would
// otherwise defeat any downstream `if (!process.env.X)` guard.
if (!process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_URL) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_URL
}
if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.SUPABASE_ANON_KEY) {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY
}

const REQUIRED_VARS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] as const

for (const name of REQUIRED_VARS) {
  if (!process.env[name]) {
    throw new Error(
      `Missing required env var ${name} in ${envPath}. ` +
        'Regenerate it with `supabase status -o env --override-name api.url=SUPABASE_URL ' +
        '--override-name auth.anon_key=SUPABASE_ANON_KEY ' +
        '--override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY` ' +
        'against a running local Supabase stack (`supabase start`).'
    )
  }
}

// Interlock: the integration suite performs destructive, RLS-bypassing
// service-role deletes (tenant cascade deletes, auth user deletes). It must
// never be able to run against a non-local Supabase project. Escape hatch
// is opt-in only, for the rare deliberate case.
const supabaseUrl = new URL(process.env.SUPABASE_URL!)
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1'])
const allowNonLocal = process.env.ALLOW_NON_LOCAL_SUPABASE === '1'

if (!LOOPBACK_HOSTNAMES.has(supabaseUrl.hostname) && !allowNonLocal) {
  throw new Error(
    `SUPABASE_URL (${process.env.SUPABASE_URL}) does not point at a local Supabase instance ` +
      `(hostname must be one of ${Array.from(LOOPBACK_HOSTNAMES).join(', ')}). ` +
      'This integration suite performs destructive, RLS-bypassing service-role deletes ' +
      '(tenant cascade deletes, auth user deletes) and must not run against a shared, ' +
      'dev, or prod project. If you deliberately intend to target a non-local project, ' +
      'set ALLOW_NON_LOCAL_SUPABASE=1 to opt in explicitly.'
  )
}

// Guard against the fixture client (NEXT_PUBLIC_SUPABASE_URL, used by app
// code under test) and the service client (SUPABASE_URL, used by test
// helpers) ever addressing different projects.
if (process.env.NEXT_PUBLIC_SUPABASE_URL !== process.env.SUPABASE_URL) {
  throw new Error(
    `NEXT_PUBLIC_SUPABASE_URL (${process.env.NEXT_PUBLIC_SUPABASE_URL}) must equal ` +
      `SUPABASE_URL (${process.env.SUPABASE_URL}) — the fixture client and the service-role ` +
      'client under test must always address the same project.'
  )
}
