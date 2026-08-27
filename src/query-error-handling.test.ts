import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Guard for F-REL-10.
 *
 * Every Supabase read used to be written as `const { data } = await supabase…`
 * with no `error`, then coalesced with `?? []`. A failed query became an empty
 * list, the page rendered HTTP 200, and Sentry saw nothing — so a broken
 * migration or an RLS regression showed up as normal-looking empty screens
 * rather than as an alert. 15 reads across 9 files were like this, found while
 * setting up Del 3 of the rollback rehearsal
 * (docs/testing/rollback-rehearsal.md).
 *
 * This test is a lint rather than a behavioural test on purpose: the defect is
 * a shape that is easy to reintroduce by copying a neighbouring query, and it
 * has to be caught in files nobody has written yet. Testing each page
 * component individually would mean mocking auth, tenant resolution and
 * routing for very little added confidence.
 *
 * If this fails, the fix is to destructure `error` and act on it — throw so
 * the failure surfaces, while keeping `?? []` for a genuinely empty result.
 * See src/app/(tenant)/[tenantSlug]/admin/scheduling/page.tsx for the idiom.
 */

/**
 * Whole of src/, not just src/app/. Route handlers and server actions live
 * under src/app/, but src/lib/ holds Supabase reads too — clean today, and
 * worth keeping that way rather than only checking where the defect happened
 * to be found.
 */
const SRC_DIR = path.join(import.meta.dirname)

function sourceFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * A named `data` destructure with no `error` alongside it, whose variable is
 * later coalesced away with a harmless-looking default. The coalesce is what
 * makes it silent: without it a null `data` would throw on first use and at
 * least be visible.
 *
 * `''` is in the list because of the SMS worker — its default was an empty
 * string, not an empty array, and that variant sent blank messages rather
 * than rendering a blank page. Any new default worth adding here is one that
 * turns "the query failed" into a value the code will happily proceed with.
 */
const SILENT_DEFAULTS = String.raw`\[\]|null|''|""`

function silentReads(src: string): string[] {
  const found: string[] = []
  const destructure = /\{\s*data:\s*(\w+)([^}]*)\}\s*=\s*await/g

  for (const match of src.matchAll(destructure)) {
    const [, name, rest] = match
    if (rest.includes('error')) continue

    // `if (!x) notFound()` / `redirect()` / a throw makes the read loud
    // enough: the request stops instead of rendering a wrong-but-plausible
    // page. Those are a separate, milder concern (the 404 is misleading) and
    // deliberately out of scope here — flagging them would make this check
    // noisy enough to be ignored, which is worse than not having it.
    const guarded = new RegExp(`if\\s*\\(\\s*!\\s*${name}\\s*\\)\\s*(notFound|redirect|throw)`)
    if (guarded.test(src)) continue

    // The name must be coalesced in an expression it is actually the subject
    // of — `name ?? d`, `name?.x ?? d`, `name?.[0] ?? d`,
    // `name?.find(...) ?? d` — rather than merely appearing on a line that
    // happens to contain a `??` belonging to some other variable. Everything
    // between the name and the `??` is therefore restricted to accessor
    // syntax: dots, optional chaining, brackets, parens, and word characters.
    const coalesced = new RegExp(
      `\\b${name}\\b[\\w.?()[\\]\\s,=>'"-]*\\?\\?\\s*(${SILENT_DEFAULTS})`
    )
    if (coalesced.test(src)) found.push(name)
  }
  return found
}

describe('Supabase reads surface their errors (F-REL-10)', () => {
  it('has no query whose failure is coalesced into an empty result', () => {
    const offenders: string[] = []

    for (const file of sourceFiles()) {
      const names = silentReads(readFileSync(file, 'utf8'))
      if (names.length > 0) {
        offenders.push(`${path.relative(SRC_DIR, file)}: ${names.join(', ')}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('detects the shape it is meant to catch', () => {
    // Guards the guard: a regex that silently stops matching would make this
    // suite pass forever while the defect walks back in.
    const bad = `
      const { data: stages } = await supabase.from('event_stages').select('id')
      const list = stages ?? []
    `
    expect(silentReads(bad)).toEqual(['stages'])

    const good = `
      const { data: stages, error } = await supabase.from('event_stages').select('id')
      if (error) throw error
      const list = stages ?? []
    `
    expect(silentReads(good)).toEqual([])
  })

  it('catches the empty-string variant, not just empty arrays', () => {
    // The SMS worker's shape. Its default was '' rather than [], and the
    // consequence was blank messages sent to real recipients rather than a
    // blank page — so this variant matters more than the array one, and an
    // earlier version of this regex missed it.
    const bad = `
      const { data: rows } = await service.from('announcements').select('id, body')
      const bodyById = new Map((rows ?? []).map((a) => [a.id, a.body]))
      await client.messages.create({ body: bodyById.get(id) ?? '' })
    `
    expect(silentReads(bad)).toEqual(['rows'])
  })

  it('catches a coalesce reached through optional chaining or an index', () => {
    // MYSCH-01's shape: the coalesce is not on the variable directly, which
    // is why the first manual survey missed it.
    const viaIndex = `
      const { data: officialsRows } = await supabase.from('officials').select('id')
      const official = officialsRows?.[0] ?? null
    `
    expect(silentReads(viaIndex)).toEqual(['officialsRows'])

    const viaProperty = `
      const { data: tenant } = await service.from('tenants').select('slug')
      return tenant?.slug ?? null
    `
    expect(silentReads(viaProperty)).toEqual(['tenant'])

    const viaCall = `
      const { data: stages } = await supabase.from('event_stages').select('id')
      const found = stages?.find((s) => s.id === id) ?? null
    `
    expect(silentReads(viaCall)).toEqual(['stages'])
  })

  it('ignores a read guarded by notFound, since the request stops there', () => {
    // Not silent: the page 404s instead of rendering something wrong. A
    // misleading 404 is a milder, separate concern, and flagging it here
    // would make the check noisy enough to be ignored.
    const guarded = `
      const { data: tenant } = await supabase.from('tenants').select('id').single()
      if (!tenant) notFound()
      const other = somethingElse ?? []
    `
    expect(silentReads(guarded)).toEqual([])
  })

  it('does not flag a read whose error is handled on a later line', () => {
    // Destructuring `error` and acting on it further down is the fix, not a
    // near-miss — the check must not push people toward one-liners.
    const good = `
      const { data: tenants, error: tenantsError } = await supabase.from('tenants').select('id')
      if (tenantsError) throw tenantsError
      return tenants ?? []
    `
    expect(silentReads(good)).toEqual([])
  })
})
