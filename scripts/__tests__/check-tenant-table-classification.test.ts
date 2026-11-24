import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// N25 decision 4: scripts/check-tenant-table-classification.sh fails CI when a
// tenant table is not in supabase/tenant-restore-tables.txt. CI feeds it the
// real catalog (integration job); here it gets the scope query's output on
// stdin ("-"), so the check's own logic is tested without a database.

const SCRIPT = path.resolve(import.meta.dirname, '../check-tenant-table-classification.sh')
const LIST = path.resolve(import.meta.dirname, '../../supabase/tenant-restore-tables.txt')

const listed = readFileSync(LIST, 'utf8')
  .split('\n')
  .map((line) => line.replace(/#.*/, '').trim())
  .filter(Boolean)
  .map((line) => line.split(/\s+/)[0])

// What tenant-scope.sql prints: "<table>|<filter>" per line.
const scopeOutput = (tables: string[]) => tables.map((t) => `${t}|tenant_id = 'x'`).join('\n')

function run(tables: string[]) {
  const result = spawnSync(SCRIPT, ['-'], { input: scopeOutput(tables), encoding: 'utf8' })
  return { status: result.status, out: result.stdout + result.stderr }
}

describe('check-tenant-table-classification.sh', () => {
  it('classifies every line as restore or keep-live', () => {
    const classes = readFileSync(LIST, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[1])
    expect(new Set(classes)).toEqual(new Set(['restore', 'keep-live']))
  })

  it('passes when the catalog and the list agree', () => {
    const { status, out } = run(listed)
    expect(status).toBe(0)
    expect(out).toContain(`All ${listed.length} tenant tables are classified.`)
  })

  it('fails on a tenant table a migration added without classifying it', () => {
    const { status, out } = run([...listed, 'new_event_log'])
    expect(status).toBe(1)
    expect(out).toMatch(/not classified[\s\S]*new_event_log/)
  })

  it('fails on a listed table that is no longer a tenant table', () => {
    const { status, out } = run(listed.filter((t) => t !== 'events'))
    expect(status).toBe(1)
    expect(out).toMatch(/not tenant tables[\s\S]*events/)
  })

  it('fails rather than passing when the catalog returns nothing', () => {
    expect(run([]).status).toBe(1)
  })

  it('keeps the log and queue tables decided on 2026-11-24 out of the restore', () => {
    const keepLive = readFileSync(LIST, 'utf8')
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim().split(/\s+/))
      .filter(([, cls]) => cls === 'keep-live')
      .map(([table]) => table)
    expect(keepLive).toEqual(
      expect.arrayContaining([
        'audit_events',
        'auth_events',
        'sms_queue',
        'sms_usage',
        'sms_cap_warnings',
      ])
    )
  })
})
