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

const APP_DIR = path.join(import.meta.dirname)

function sourceFiles(dir: string = APP_DIR): string[] {
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
 * later coalesced away with `?? []` or `?? null`. The coalesce is what makes
 * it silent: without it a null `data` would throw on first use and at least
 * be visible.
 */
function silentReads(src: string): string[] {
  const found: string[] = []
  const destructure = /\{\s*data:\s*(\w+)([^}]*)\}\s*=\s*await/g

  for (const match of src.matchAll(destructure)) {
    const [, name, rest] = match
    if (rest.includes('error')) continue
    const coalesced = new RegExp(`\\b${name}\\s*\\?\\?\\s*(\\[\\]|null)`)
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
        offenders.push(`${path.relative(APP_DIR, file)}: ${names.join(', ')}`)
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
})
