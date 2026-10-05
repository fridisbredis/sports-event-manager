import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// Regression tests for scripts/check-snapshot-claim.sh (REL-04, the
// requirement older comments cite as F-REL-20).
//
// The script gates prod migrations from two directions — blocking in
// deploy-prod.yml and advisory in quality.yml — so a silent regression in it
// either lets an unsnapshotted destructive migration reach prod or blocks a
// legitimate deploy. PR #184 verified these cases by hand; this file is the
// committed version of that verification.
//
// The script's interface is deliberately small: one file path in, exit 0/1/2
// out plus one line on stdout. So the harness just runs the real script
// against fixture migrations rather than reimplementing any of its logic.

const SCRIPT = path.resolve(import.meta.dirname, '../check-snapshot-claim.sh')
const FIXTURES = path.resolve(import.meta.dirname, 'fixtures')

function run(fixture: string) {
  const result = spawnSync(SCRIPT, [path.join(FIXTURES, fixture)], {
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('check-snapshot-claim.sh', () => {
  describe('accepts a verified constraint-only exemption', () => {
    it('passes a migration that only adds a constraint', () => {
      const { status, stdout } = run('0100_constraint_only.sql')
      expect(status).toBe(0)
      expect(stdout).toContain('verified: no row-writing SQL')
    })

    it('ignores DELETE inside a $$-quoted function body', () => {
      // Defining a function that deletes rows is not this migration writing
      // rows — it writes them only when something later calls it.
      const { status, stdout } = run('0104_delete_in_function_body.sql')
      expect(status).toBe(0)
      expect(stdout).toContain('verified: no row-writing SQL')
    })

    it('ignores DELETE and TRUNCATE inside comments', () => {
      const { status, stdout } = run('0105_delete_in_comment.sql')
      expect(status).toBe(0)
      expect(stdout).toContain('verified: no row-writing SQL')
    })
  })

  describe('rejects a claim the SQL contradicts', () => {
    it('fails a claim accompanied by a backfill UPDATE', () => {
      const { status, stdout } = run('0101_claim_with_backfill.sql')
      expect(status).toBe(1)
      expect(stdout).toContain('writes rows or drops a column')
    })

    it('fails a claim accompanied by DROP COLUMN', () => {
      const { status, stdout } = run('0102_claim_with_drop_column.sql')
      expect(status).toBe(1)
      expect(stdout).toContain('writes rows or drops a column')
    })

    it('fails a claim whose UPDATE is split across newlines', () => {
      // Eddo's note 1 on PR #184. The original implementation matched with
      // grep -E, which is line-oriented, so `UPDATE\n  officials SET ...`
      // slipped through the same check that catches the single-line form in
      // 0101 — a migration could buy its exemption purely by reformatting.
      const { status, stdout } = run('0106_multiline_backfill.sql')
      expect(status).toBe(1)
      expect(stdout).toContain('writes rows or drops a column')
    })
  })

  describe('accepts a referenced snapshot filename', () => {
    it('accepts a legacy 00NN-prefixed snapshot name', () => {
      const { status, stdout } = run('0103_snapshot_legacy_name.sql')
      expect(status).toBe(0)
      expect(stdout).toContain('snapshot filename present')
    })

    it('accepts a YYYYMMDDHHMMSS-prefixed snapshot name', () => {
      // The 2026-09-11 prod-deploy failure: the filename pattern only allowed
      // 4-digit prefixes, so every migration named by the Supabase CLI's
      // timestamp scheme was rejected however valid its snapshot was.
      const { status, stdout } = run('20260911081402_snapshot_timestamp_name.sql')
      expect(status).toBe(0)
      expect(stdout).toContain('snapshot filename present')
    })
  })

  describe('rejects a destructive migration that claims nothing', () => {
    it('fails when there is no Data: line at all', () => {
      const { status, stdout } = run('0107_no_data_line.sql')
      expect(status).toBe(1)
      expect(stdout).toContain('no snapshot filename in its Data: line')
    })
  })

  describe('usage', () => {
    it('exits 2 when the file does not exist', () => {
      const result = spawnSync(SCRIPT, [path.join(FIXTURES, 'does-not-exist.sql')], {
        encoding: 'utf8',
      })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Usage:')
    })

    it('exits 2 when no argument is given', () => {
      const result = spawnSync(SCRIPT, [], { encoding: 'utf8' })
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('Usage:')
    })
  })
})
