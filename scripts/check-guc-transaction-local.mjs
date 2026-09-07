#!/usr/bin/env node
// PERF-06 / ADR-0003 rule 5: every `app.*` session variable a migration sets
// must be set TRANSACTION-LOCALLY — `set_config('app.x', v, true)` with the
// third argument literally `true`.
//
// Why this is a guard and not a code-review habit: the Group 1 caching RPCs
// (0048 onward) reach RLS by setting `app.tenant_id` and having a policy
// compare it. If that GUC is ever set session-scoped instead — a `false` or
// omitted third argument, or a bare `SET app.tenant_id = ...` — it survives
// past the transaction on a pooled PostgREST/Supavisor connection and
// misapplies one tenant's scoping to a later, unrelated request. Nothing
// else catches it: the RPC still returns correct data for the request that
// set it, so tests pass, and the leak only appears under connection reuse.
//
// Whole-tree scan, not diff-scoped (unlike check-rpc-shape.mjs, which has to
// compare two versions of the same function to see a dropped key). This
// invariant should hold for every migration in the tree at all times, and
// scanning from disk means no base-ref resolution to get wrong. Every
// migration present when this guard was written already complies.
//
// Node only (no shell scripting) so this runs the same way on the Windows
// and macOS machines this team develops on, and in CI.
//
// Usage: node scripts/check-guc-transaction-local.mjs [migrationsDir]

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv[2] ?? 'supabase/migrations'

// Blanks out `--` line comments so commented-out or documented examples don't
// trip the guard, while respecting single-quoted string literals (a `--`
// inside a quoted string is not a comment). Replaces with spaces rather than
// deleting so reported line/column numbers stay true to the file.
function stripLineComments(sql) {
  let out = ''
  let inString = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (inString) {
      out += c
      if (c === "'") inString = false
      continue
    }
    if (c === "'") {
      inString = true
      out += c
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      // Blank to end of line.
      while (i < sql.length && sql[i] !== '\n') {
        out += ' '
        i++
      }
      out += '\n'
      continue
    }
    out += c
  }
  return out
}

// Splits the argument list of a call, respecting nested parens and quotes, so
// a second argument like `coalesce(a, b)` counts as one argument.
function splitArgs(sql, openParenIndex) {
  const args = []
  let depth = 0
  let current = ''
  let inString = false
  for (let i = openParenIndex; i < sql.length; i++) {
    const c = sql[i]
    if (inString) {
      current += c
      if (c === "'") inString = false
      continue
    }
    if (c === "'") {
      inString = true
      current += c
      continue
    }
    if (c === '(') {
      depth++
      if (depth === 1) continue // skip the opening paren itself
      current += c
      continue
    }
    if (c === ')') {
      depth--
      if (depth === 0) {
        args.push(current)
        return args
      }
      current += c
      continue
    }
    if (c === ',' && depth === 1) {
      args.push(current)
      current = ''
      continue
    }
    current += c
  }
  return null // unbalanced
}

function lineOf(sql, index) {
  return sql.slice(0, index).split('\n').length
}

const violations = []

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort()

for (const file of files) {
  const path = join(DIR, file)
  const raw = readFileSync(path, 'utf8')
  const sql = stripLineComments(raw)

  // --- set_config('app.x', value, <third arg>) ---
  const callRe = /set_config\s*\(/gi
  let m
  while ((m = callRe.exec(sql)) !== null) {
    const openParen = sql.indexOf('(', m.index)
    const args = splitArgs(sql, openParen)
    if (!args) continue

    const name = (args[0] ?? '').trim()
    if (!/^'app\./i.test(name)) continue // only app.* GUCs are in scope

    const third = (args[2] ?? '').trim().toLowerCase()
    if (third !== 'true') {
      violations.push({
        file,
        line: lineOf(sql, m.index),
        detail:
          args.length < 3
            ? `set_config(${name}, ...) has no third argument — it defaults to session-scoped`
            : `set_config(${name}, ...) third argument is \`${(args[2] ?? '').trim()}\`, not \`true\``,
      })
    }
  }

  // --- bare `SET app.x = ...`, which is session-scoped by default ---
  const bareRe = /\bset\s+(?!local\b)(app\.[a-z_][a-z0-9_]*)\s*(=|\bto\b)/gi
  while ((m = bareRe.exec(sql)) !== null) {
    violations.push({
      file,
      line: lineOf(sql, m.index),
      detail: `bare \`SET ${m[1]}\` is session-scoped — use set_config('${m[1]}', <value>, true)`,
    })
  }
}

if (violations.length > 0) {
  console.error('Session-scoped `app.*` GUC found in a migration:\n')
  for (const v of violations) {
    console.error(`  ${DIR}/${v.file}:${v.line}`)
    console.error(`    ${v.detail}\n`)
  }
  console.error(
    'An `app.*` GUC set session-scoped survives past its transaction on a\n' +
      'pooled PostgREST/Supavisor connection and misapplies tenant scoping to a\n' +
      'later, unrelated request. Pass `true` as the third argument to\n' +
      'set_config so it reverts at end of transaction.\n' +
      'See ADR-0003 rule 5 and .claude/CLAUDE.md.'
  )
  process.exit(1)
}

console.log(
  `No session-scoped \`app.*\` GUCs. Checked ${files.length} migration${files.length === 1 ? '' : 's'}.`
)
