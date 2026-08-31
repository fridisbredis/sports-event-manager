// Runs seed-dev.ts against the local Supabase stack instead of the dev cloud
// project.
//
// scripts/seed-dev.ts loads .env.local via dotenv without `override: true`, so
// the shell environment wins — setting these two variables here is what
// redirects the seed at the local stack. .env.local points at the dev cloud
// project, which is correct for running the app but wrong for seeding.
//
// WHY THIS IS NODE AND NOT A SHELL SCRIPT
//
// It was a bash script, and could not run on Windows. npm runs scripts through
// cmd.exe there, and `bash` does not resolve to Git Bash on a default PATH:
// Git for Windows only adds `Git\cmd` (which has git.exe but not bash.exe),
// so `bash` hits the WSL shim in WindowsApps and fails with execvpe(/bin/bash).
// An earlier revision had the same class of bug with `python3`, which is also
// absent from a default Windows PATH.
//
// CI cannot catch either one: no workflow runs this script, and ubuntu-latest
// has both a real bash and python3. Node is guaranteed present inside an npm
// script and needs no new dependency, so the whole class goes away.

import { spawnSync } from 'node:child_process'

function fail(message, detail) {
  console.error(message)
  if (detail) console.error(detail)
  process.exit(1)
}

// `supabase status -o json` prints the local stack's URLs and keys. It exits
// non-zero when the stack is not running, which is the check that used to be a
// separate `supabase status >/dev/null` call.
const status = spawnSync('supabase', ['status', '-o', 'json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32', // supabase is a .cmd shim on Windows
})

if (status.error || status.status !== 0) {
  fail(
    'Local Supabase stack is not running. Start it first: supabase start',
    status.stderr?.trim() || status.error?.message
  )
}

let parsed
try {
  parsed = JSON.parse(status.stdout)
} catch {
  fail("Could not parse the output of 'supabase status -o json'.", status.stdout?.slice(0, 400))
}

const apiUrl = parsed.API_URL
const serviceRoleKey = parsed.SERVICE_ROLE_KEY

// A partially-started stack can report success while leaving fields null. The
// bash version could not catch this — `read` succeeds whatever it reads, so a
// missing key arrived as the string "null" and sailed past seed-dev.ts's own
// missing-key check into a confusing downstream API error.
if (typeof apiUrl !== 'string' || !apiUrl.startsWith('http') || !serviceRoleKey) {
  fail(
    "Could not read local Supabase credentials from 'supabase status -o json'.",
    `Got API_URL=${JSON.stringify(apiUrl)}. Is the stack fully up? ` +
      'Try: supabase stop && supabase start'
  )
}

// seed-dev.ts has its own guard refusing anything that is not the dev project
// or a loopback host, so this cannot reach prod even if the values were wrong.
const seed = spawnSync('tsx', ['scripts/seed-dev.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  },
})

if (seed.error) fail('Could not run scripts/seed-dev.ts', seed.error.message)
process.exit(seed.status ?? 1)
