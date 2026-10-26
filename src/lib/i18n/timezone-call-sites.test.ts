import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { globSync } from 'tinyglobby'

/**
 * What this guards: a date or time rendered with NO explicit `timeZone`.
 *
 * The app has two deliberately opposite timestamp conventions, and both
 * depend on the zone being stated at every call site:
 *
 *   - wall-clock UTC (scheduling: stages, slots, assignments) -> 'UTC'
 *   - a real instant (announcements.published_at, audit created_at)
 *     -> EVENT_TIME_ZONE
 *
 * Omit the option and the runtime falls back to the host zone. On a laptop in
 * Stockholm that silently produces the right answer; the Azure image sets no
 * TZ, so prod formats as UTC and every instant reads two hours early in
 * summer. That is B10: an announcement published at 11:09 shown as "09:09".
 *
 * The existing event-time-zone.test.ts pins the CONSTANT. It cannot see a new
 * component that formats a date without reaching for it, which is exactly how
 * this regressed after PR #268 had already fixed the two known screens. This
 * test reads the source instead, so a new unpinned call site fails CI on the
 * commit that introduces it rather than during a demo.
 *
 * It is a lint rule expressed as a test rather than an ESLint plugin: the
 * whole rule is visible in one file, and it needs no custom-rule tooling to
 * stay maintained.
 */

const SRC = join(process.cwd(), 'src')

// The formatting calls that take an options bag with `timeZone` in it.
// `.toISOString()` is deliberately absent: it is always UTC by definition and
// is the correct way to serialise an instant.
const FORMATTERS = ['toLocaleString', 'toLocaleTimeString', 'toLocaleDateString', 'DateTimeFormat']

/**
 * Source files that actually render for a user. Tests are excluded because a
 * test asserting the unpinned default is a legitimate thing to write — that is
 * precisely what event-time-zone.test.ts does to demonstrate the drift.
 */
function sourceFiles(): string[] {
  return globSync(['**/*.ts', '**/*.tsx'], {
    cwd: SRC,
    absolute: true,
    ignore: ['**/*.test.ts', '**/*.test.tsx', '**/*.d.ts'],
  })
}

/**
 * The call's argument list, from the opening paren to its match.
 *
 * Brace/paren counting rather than a regex: an options bag spans several lines
 * and frequently contains nested objects and template strings, which a regex
 * either truncates (missing a `timeZone` further down, producing a false
 * failure) or runs past (swallowing the next call, producing a false pass).
 */
function callArgs(source: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') depth++
    else if (ch === ')') {
      depth--
      if (depth === 0) return source.slice(openParen + 1, i)
    }
  }
  // Unbalanced source would not compile; treat it as nothing to check.
  return ''
}

interface CallSite {
  file: string
  line: number
  formatter: string
}

function unpinnedCallSites(): CallSite[] {
  const offenders: CallSite[] = []

  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')

    for (const formatter of FORMATTERS) {
      // Every occurrence of the method name followed by its call parens.
      const pattern = new RegExp(`\\b${formatter}\\s*\\(`, 'g')
      let match: RegExpExecArray | null

      while ((match = pattern.exec(source)) !== null) {
        const openParen = match.index + match[0].length - 1
        const args = callArgs(source, openParen)

        // A call that names a zone is fine whichever convention it picked;
        // choosing the WRONG one of the two is a semantic question this test
        // cannot answer, and event-time-zone.test.ts covers the constant.
        if (/\btimeZone\s*:/.test(args)) continue

        // The options bag is often hoisted into a variable and shared by two
        // calls (`toLocaleDateString(locale, opts)`), which is good practice
        // where one format is applied to a start and an end. The zone is
        // pinned there rather than at the call, so resolve the identifier and
        // check its declaration before calling this a miss — otherwise the
        // test would push people to inline a shared object to appease it.
        const passedVar = args.match(/,\s*([A-Za-z_$][\w$]*)\s*$/)
        if (passedVar) {
          const decl = new RegExp(
            `\\b(?:const|let|var)\\s+${passedVar[1]}\\b[^=]*=\\s*{[\\s\\S]*?\\btimeZone\\s*:`
          )
          if (decl.test(source)) continue
        }

        offenders.push({
          file: file.slice(process.cwd().length + 1),
          line: source.slice(0, match.index).split('\n').length,
          formatter,
        })
      }
    }
  }

  return offenders
}

describe('date formatting call sites', () => {
  it('always pin an explicit timeZone', () => {
    const offenders = unpinnedCallSites()

    // The message carries the fix, not just the failure: whoever trips this is
    // adding a component, not debugging timezones, and needs to know which of
    // the two conventions applies to the value they are rendering.
    const detail = offenders
      .map((o) => `  ${o.file}:${o.line} — ${o.formatter}() has no timeZone`)
      .join('\n')

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : `Date formatted without an explicit timeZone:\n${detail}\n\n` +
            `Without it the host zone decides: correct on a Stockholm laptop, ` +
            `two hours early on the UTC container in prod (B10).\n` +
            `Pick the convention that matches the value:\n` +
            `  • a real instant (announcements.published_at, audit created_at)\n` +
            `      -> timeZone: EVENT_TIME_ZONE  from '@/lib/i18n/date-locale'\n` +
            `  • wall-clock UTC (stages, slots, assignments)\n` +
            `      -> timeZone: 'UTC'  (or the helpers in '@/lib/i18n/stage-range')`
    ).toEqual([])
  })

  it('finds the call sites it is meant to police', () => {
    // A guard whose scan silently matched nothing would pass for ever. The
    // real codebase formats dates in a good few places; if this count ever
    // collapses to zero the detection has broken, not the codebase.
    const scanned = sourceFiles()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    const total = FORMATTERS.reduce(
      (n, f) => n + (scanned.match(new RegExp(`\\b${f}\\s*\\(`, 'g'))?.length ?? 0),
      0
    )

    expect(total).toBeGreaterThan(10)
  })
})
