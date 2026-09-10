import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Guard for REL-03's observability half, and for the gap F-REL-10 left open.
 *
 * PR #76 fixed the page-component side of silent query failures and left
 * `src/query-error-handling.test.ts` as its lint. That check catches one
 * shape — `const { data } = await …` coalesced into `?? []` — and its own
 * closing note says server actions and route handlers "were not surveyed
 * here; the 15 counted reads are page components only". They had the same
 * defect in two forms:
 *
 *   1. Every write in the two cron handlers was fire-and-forget. The
 *      `sms_queue` status update after a successful send, the
 *      `gdpr_warning_sent_at` marker, the `sms_sent` reconcile — none
 *      destructured `error`. The consequences are not cosmetic: a lost
 *      status update leaves a row stuck in `sending` or re-sends it; a lost
 *      GDPR marker re-warns the same person on every tick.
 *   2. Nine sites destructured `error`, used it for control flow, and never
 *      logged it — the caller got a 500 or an error string and nothing
 *      reached Sentry or Log Analytics. `pg_cron` collects the response body
 *      and discards it, so for the cron handlers there was no observer at all.
 *
 * Why this is a separate file from query-error-handling.test.ts: that check
 * asks "does a failure reach control flow", which is the right question for a
 * page that can throw into an error boundary. This one asks "does a failure
 * reach an operator", which only matters where nothing throws — a handler that
 * returns its own 500, or a cron tick nobody is watching. Same defect class,
 * different question, and keeping them apart means a failure message names
 * which one to fix.
 *
 * Scope is deliberately server actions and route handlers only. Page
 * components are covered by the sibling check and by the error boundaries PR
 * #76 added; adding them here would flag every read that correctly throws.
 */

const SRC_DIR = path.join(import.meta.dirname)

/** src/lib/actions/*.ts and src/app/api/**\/route.ts, minus tests. */
function surveyedFiles(): string[] {
  const out: string[] = []

  const walk = (dir: string, keep: (f: string) => boolean) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, keep)
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && keep(full)) {
        out.push(full)
      }
    }
  }

  walk(path.join(SRC_DIR, 'lib', 'actions'), () => true)
  walk(path.join(SRC_DIR, 'app', 'api'), (f) => path.basename(f) === 'route.ts')
  return out
}

/**
 * A write whose result is discarded entirely — `await supabase.from(x).update(…)`
 * as a statement, with nothing destructured off it. Reads are not checked here:
 * a read's result is used by definition, so the sibling check's coalesce test is
 * the right instrument for those.
 *
 * Matching is on the statement opener rather than the whole chain: the chain can
 * span a dozen lines, and what makes it fire-and-forget is visible at the start —
 * an `await` that is not assigned to anything.
 */
function unassignedWrites(src: string): string[] {
  const found: string[] = []
  // Start of a statement (not preceded by `=`, `(`, `return`, etc.) that awaits
  // a supabase-ish client and reaches a write method somewhere in the chain.
  const pattern =
    /(^|\n)[ \t]*await\s+(\w+)\s*\n?[ \t]*\.from\([^)]*\)[\s\S]{0,400}?\.(insert|update|delete|upsert)\(/g

  for (const match of src.matchAll(pattern)) {
    found.push(`${match[2]}.${match[3]}`)
  }
  return found
}

/**
 * An auth call whose `error` is never destructured — `const { data: { user } } =
 * await supabase.auth.getUser()`.
 *
 * This is the same defect as `unassignedWrites` in a shape neither of the other
 * two checks can see: the result *is* assigned, so it is not fire-and-forget,
 * and the file never binds `error` at all, so `branchesOnErrorWithoutLogging`
 * returns early before it can fire. That blind spot let three call sites
 * (`confirmInviteByPhone`, `publishEvent`, `PATCH /api/account`) survive the
 * first pass of this survey — an unreachable GoTrue was indistinguishable from
 * an expired session, and produced a redirect or a 401 with nothing logged.
 *
 * Matching is on the destructuring pattern rather than the call: what makes it
 * unobservable is that the awaited result's `error` half is thrown away, which
 * is visible in the binding alone.
 */
function authCallsDiscardingError(src: string): string[] {
  const found: string[] = []
  // `const { data … } = await <client>.auth.<method>(` with no `error` bound.
  const pattern =
    /(?:const|let)\s*(\{[\s\S]{0,120}?\})\s*=\s*await\s+\w+\s*\.auth\s*\.\s*(?:admin\s*\.\s*)?(\w+)\s*\(/g

  for (const match of src.matchAll(pattern)) {
    if (!/\berror\b/.test(match[1])) found.push(`auth.${match[2]}`)
  }
  return found
}

/**
 * An error that is destructured and used for control flow but never logged.
 *
 * Detection is per-file rather than per-query on purpose: tying a specific
 * `error` binding to a specific `logQueryError` call needs real scope analysis,
 * and a regex that tries collapses into false positives the moment a handler
 * has two queries. The useful invariant at file granularity is weaker but
 * still holds: a surveyed file that branches on a query error must contain at
 * least one logging call. That catches the whole-file omission this actually
 * was — nine sites across eight files, none of which logged anything — and
 * stays quiet on files that log correctly.
 */
function branchesOnErrorWithoutLogging(src: string): boolean {
  const destructuresError = /\{[^}]*\berror\b[^}]*\}\s*=\s*await/.test(src)
  if (!destructuresError) return false

  // Named `error`/`somethingError` used in a condition.
  const branchesOnError = /if\s*\([^)]*\b\w*[eE]rror\b/.test(src)
  if (!branchesOnError) return false

  const logs = /logQueryError\s*\(|logger\.(error|warn)\s*\(/.test(src)
  return !logs
}

describe('query failures in server actions and route handlers are observable (REL-03)', () => {
  it('has no write whose result is discarded entirely', () => {
    const offenders: string[] = []

    for (const file of surveyedFiles()) {
      const writes = unassignedWrites(readFileSync(file, 'utf8'))
      if (writes.length > 0) {
        offenders.push(`${path.relative(SRC_DIR, file)}: ${writes.join(', ')}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('has no file that branches on a query error without logging any', () => {
    const offenders = surveyedFiles()
      .filter((file) => branchesOnErrorWithoutLogging(readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC_DIR, file))

    expect(offenders).toEqual([])
  })

  it('has no auth call whose error is discarded', () => {
    const offenders: string[] = []

    for (const file of surveyedFiles()) {
      const calls = authCallsDiscardingError(readFileSync(file, 'utf8'))
      if (calls.length > 0) {
        offenders.push(`${path.relative(SRC_DIR, file)}: ${calls.join(', ')}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('detects an auth call that discards its error', () => {
    const bad = `
      const {
        data: { user },
      } = await supabase.auth.getUser()
    `
    expect(authCallsDiscardingError(bad)).toEqual(['auth.getUser'])

    const good = `
      const { data, error: authError } = await supabase.auth.getUser()
    `
    expect(authCallsDiscardingError(good)).toEqual([])

    const admin = `
      const { data: created } = await service.auth.admin.createUser({ phone })
    `
    expect(authCallsDiscardingError(admin)).toEqual(['auth.createUser'])
  })

  it('detects a fire-and-forget write', () => {
    // Guards the guard — a regex that stopped matching would make this suite
    // pass forever while the defect walked back in.
    const bad = `
      await service
        .from('sms_queue')
        .update({ status: 'sent' })
        .eq('id', row.id)
    `
    expect(unassignedWrites(bad)).toEqual(['service.update'])

    const good = `
      const { error } = await service
        .from('sms_queue')
        .update({ status: 'sent' })
        .eq('id', row.id)
      if (error) logQueryError(error, ctx)
    `
    expect(unassignedWrites(good)).toEqual([])
  })

  it('does not flag a read as a fire-and-forget write', () => {
    const read = `
      const { data, error } = await supabase.from('officials').select('id')
    `
    expect(unassignedWrites(read)).toEqual([])
  })

  it('detects a file that branches on an error and logs nothing', () => {
    const bad = `
      const { data, error } = await supabase.from('officials').select('id')
      if (error) {
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
    `
    expect(branchesOnErrorWithoutLogging(bad)).toBe(true)

    const good = `
      const { data, error } = await supabase.from('officials').select('id')
      if (error) {
        logQueryError(error, { op: 'x', table: 'officials', kind: 'select' })
        return NextResponse.json({ error: 'Failed' }, { status: 500 })
      }
    `
    expect(branchesOnErrorWithoutLogging(good)).toBe(false)
  })

  it('stays quiet on a file with no query at all', () => {
    const none = `
      export async function GET() {
        return NextResponse.json({ ok: true })
      }
    `
    expect(branchesOnErrorWithoutLogging(none)).toBe(false)
    expect(unassignedWrites(none)).toEqual([])
    expect(authCallsDiscardingError(none)).toEqual([])
  })
})
