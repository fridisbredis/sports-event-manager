import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

// B23: scripts/ops/backup-slot.sh picks the weekly backup's rotation slot.
// Runs the real script, as check-snapshot-claim.test.ts does, rather than
// re-implementing its arithmetic here.

const SCRIPT = path.resolve(import.meta.dirname, '../ops/backup-slot.sh')

function run(iso: string) {
  const seconds = String(Math.floor(new Date(iso).getTime() / 1000))
  const result = spawnSync(SCRIPT, [seconds], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  const out = Object.fromEntries(
    result.stdout
      .trim()
      .split('\n')
      .map((line) => line.split('='))
  )
  return { slot: Number(out.slot), week: out.week as string }
}

// The schedule's Sunday runs, 03:17 UTC.
const sunday = (date: string) => `${date}T03:17:00Z`

describe('backup-slot.sh', () => {
  it('gives four different slots to four consecutive weeks across the 53-week new year', () => {
    const runs = ['2026-12-27', '2027-01-03', '2027-01-10', '2027-01-17'].map((d) => run(sunday(d)))

    expect(runs.map((r) => r.week)).toEqual(['52', '53', '01', '02'])
    expect(new Set(runs.map((r) => r.slot)).size).toBe(4)
  })

  it('never lets week 1 reuse the slot of week 53 (the bug)', () => {
    expect(run(sunday('2027-01-10')).slot).not.toBe(run(sunday('2027-01-03')).slot)
  })

  it('matches the old ISO-week-mod-4 slot for every week of 2026, so the switch overwrote nothing early', () => {
    // Every Sunday from 2026-01-04 (ISO W01) through 2027-01-03 (W53).
    const start = new Date('2026-01-04T03:17:00Z').getTime()
    for (let i = 0; i < 53; i++) {
      const iso = new Date(start + i * 7 * 86_400_000).toISOString()
      const { slot, week } = run(iso)
      expect(slot, `ISO week ${week}`).toBe(Number(week) % 4)
    }
  })

  it('puts Monday and Sunday of the same ISO week in the same slot', () => {
    // A manual run on Monday 2026-11-16 and the scheduled one on 2026-11-22 were both week 47.
    const monday = run('2026-11-16T13:38:24Z')
    const sundayRun = run('2026-11-22T11:37:07Z')

    expect(monday).toEqual(sundayRun)
    expect(monday).toEqual({ slot: 3, week: '47' })
  })

  it('moves to the next slot at Monday 00:00 UTC, not before', () => {
    expect(run('2026-11-29T23:59:59Z').slot).toBe(0) // still week 48
    expect(run('2026-11-30T00:00:00Z').slot).toBe(1) // week 49
  })

  it('rejects an argument that is not a number of seconds', () => {
    const result = spawnSync(SCRIPT, ['2026-11-24'], { encoding: 'utf8' })
    expect(result.status).toBe(2)
  })
})
