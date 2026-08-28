// Removes everything scripts/seed-perf.ts created, so the perf dataset can be
// reseeded without a full `supabase db reset`.
//
// Usage: npm run seed:perf:clean
//
// Deleting the tenant cascades to events, stages, workstations, officials,
// assignments and announcements. The auth.users rows do NOT cascade — they live
// in the auth schema with no FK to tenants — so they are deleted explicitly by
// matching the perf phone prefix.
//
// Same localhost-only guard as the seed — see scripts/perf-env.ts. Deleting is
// the more dangerous direction, so the guard matters more here, not less.

import { createPerfClient, PERF_SLUG_PREFIX, PERF_PHONE_PREFIX } from './perf-env'

const SLUG_PREFIX = PERF_SLUG_PREFIX
const PHONE_PREFIX = PERF_PHONE_PREFIX

async function main() {
  // Resolved here, not at module scope, so a guard failure prints as a message.
  const admin = createPerfClient()

  const { data: tenants, error } = await admin
    .from('tenants')
    .select('id, slug')
    .like('slug', `${SLUG_PREFIX}-%`)

  if (error) throw error

  if (!tenants || tenants.length === 0) {
    console.log(`No tenants matching '${SLUG_PREFIX}-%' — nothing to clean.`)
  } else {
    for (const tenant of tenants) {
      const { error: deleteError } = await admin.from('tenants').delete().eq('id', tenant.id)
      if (deleteError) throw new Error(`Failed to delete ${tenant.slug}: ${deleteError.message}`)
      console.log(`  deleted tenant ${tenant.slug}`)
    }
  }

  // auth.users cleanup — these have no FK to tenants and would otherwise
  // accumulate across reseeds, eventually colliding on the phone pool.
  let page = 1
  let deleted = 0
  for (;;) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (listError) throw listError

    const perfUsers = data.users.filter((u) => u.phone?.startsWith(PHONE_PREFIX))
    for (const user of perfUsers) {
      const { error: delError } = await admin.auth.admin.deleteUser(user.id)
      if (delError) throw delError
      deleted += 1
    }

    if (data.users.length < 1000) break
    page += 1
  }

  console.log(`  deleted ${deleted} auth users with phone prefix ${PHONE_PREFIX}`)
  console.log('Clean.')
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
