import { describe, it, expect } from 'vitest'
import { getAllocableRange, getAllocableDays } from './allocable-range'
import { generateSlotsForDay, type StageWindow } from './grid-logic'

// The BUG-02 invariant: every whole slot inside a stage's allocable range is
// allocable. "Allocable" means the grid actually renders a cell for it —
// scheduling-grid.tsx shows one day at a time and takes its slots solely from
// generateSlotsForDay, so a slot that is never generated cannot be staffed.
//
// This is written as a generated sweep rather than a handful of examples on
// purpose. The defect it guards against does not live in any single stage
// configuration; it lives in a combination (an unaligned start time crossing a
// day boundary) that no one thought to write down as an example. An example
// test would have passed before the bug too.
//
// The sweep is deterministic — a fixed cross-product, not randomness — so a
// failure reproduces exactly and CI does not go flaky.

const GRANULARITIES = [15, 30, 60]
const STAGE_TYPES = ['race', 'training']

// Minute offsets a real stage start can land on. The unaligned ones matter
// most: an admin typing 21:07 is ordinary, and nothing constrains a stage to
// start on a granularity boundary.
const MINUTE_OFFSETS = [0, 7, 15, 23, 30, 45, 50]

// Durations in minutes, chosen to cover: within one day, exactly a day,
// just under and just over a day, and a multi-day stage.
const DURATIONS = [45, 90, 240, 1437, 1440, 1500, 2880]

// Start hours that put the range on either side of a UTC midnight.
const START_HOURS = [0, 9, 22, 23]

/**
 * Every slot the grid can actually render for this stage, across all of its
 * allocable days — exactly the production path: getAllocableDays() then
 * generateSlotsForDay() per day.
 */
function allRenderableSlots(stage: StageWindow, granularityMin: number): Set<number> {
  return new Set(
    getAllocableDays(stage)
      .flatMap((day) => generateSlotsForDay(stage, day, granularityMin))
      .map((slot) => slot.getTime())
  )
}

/**
 * The slots that ought to exist: walk the allocable range from its start in
 * granularity-sized steps, keeping every step that BEGINS inside the range.
 *
 * The final step may run past the range end. That is the contract the grid
 * already implements (`while (cur < end)` in generateSlotsForDay): a stage
 * whose length is not a whole number of slots still gets a cell for its tail,
 * because the alternative is that the last minutes cannot be staffed at all.
 */
function expectedSlots(stage: StageWindow, granularityMin: number): number[] {
  const range = getAllocableRange(stage)
  if (!range) return []

  const stepMs = granularityMin * 60 * 1000
  const rangeStart = new Date(range.start).getTime()
  const rangeEnd = new Date(range.end).getTime()

  const expected: number[] = []
  for (let t = rangeStart; t < rangeEnd; t += stepMs) {
    expected.push(t)
  }
  return expected
}

interface Case {
  stage: StageWindow
  granularityMin: number
  label: string
}

function buildCases(): Case[] {
  const cases: Case[] = []

  // A fixed anchor date. Deliberately not derived from "today": these cases
  // assert pure arithmetic over UTC instants, and the invariant must not
  // depend on when the suite runs. (The seed-relative rule applies to data
  // seeded into the database, which this test never touches.)
  const anchor = Date.UTC(2026, 7, 10)

  for (const granularityMin of GRANULARITIES) {
    for (const stage_type of STAGE_TYPES) {
      for (const hour of START_HOURS) {
        for (const minute of MINUTE_OFFSETS) {
          for (const durationMin of DURATIONS) {
            const start = anchor + hour * 3_600_000 + minute * 60_000
            const end = start + durationMin * 60_000
            cases.push({
              granularityMin,
              stage: {
                stage_type,
                start_time: new Date(start).toISOString(),
                end_time: new Date(end).toISOString(),
              },
              label: `${stage_type} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} +${durationMin}min @${granularityMin}min`,
            })
          }
        }
      }
    }
  }

  return cases
}

describe('BUG-02 invariant: every whole slot inside the allocable range is allocable', () => {
  const cases = buildCases()

  it('generates a meaningful number of configurations to check', () => {
    // Guards the sweep itself: a refactor that empties one of the arrays above
    // would otherwise turn this whole file into a silent no-op.
    expect(cases.length).toBe(
      GRANULARITIES.length *
        STAGE_TYPES.length *
        START_HOURS.length *
        MINUTE_OFFSETS.length *
        DURATIONS.length
    )
  })

  it('renders a cell for every whole slot in every stage configuration', () => {
    const failures: string[] = []

    for (const { stage, granularityMin, label } of cases) {
      const renderable = allRenderableSlots(stage, granularityMin)
      const missing = expectedSlots(stage, granularityMin).filter((t) => !renderable.has(t))

      if (missing.length > 0) {
        const range = getAllocableRange(stage)
        failures.push(
          `${label}: ${missing.length} slot(s) inside [${range?.start} .. ${range?.end}] have no cell. ` +
            `First: ${new Date(missing[0]).toISOString()}`
        )
      }
    }

    expect(
      failures,
      `${failures.length} of ${cases.length} stage configurations drop slots that lie inside the allocable range:\n` +
        failures.slice(0, 10).join('\n') +
        (failures.length > 10 ? `\n…and ${failures.length - 10} more` : '')
    ).toEqual([])
  })

  it('never starts a cell outside the allocable range', () => {
    // The mirror of the invariant. Dropping slots and inventing them are both
    // failures, and a naive fix for the first can easily cause the second.
    //
    // Only the slot's START is checked, not its end. generateSlotsForDay runs
    // `while (cur < end)`, so a stage whose length is not a whole number of
    // slots gets a final partial cell that runs past the range — deliberately,
    // because the alternative is that the tail of the stage has no cell at all
    // and cannot be staffed. A slot that BEGINS outside the range is the real
    // defect.
    const failures: string[] = []

    for (const { stage, granularityMin, label } of cases) {
      const range = getAllocableRange(stage)
      if (!range) continue

      const rangeStart = new Date(range.start).getTime()
      const rangeEnd = new Date(range.end).getTime()

      for (const slotMs of allRenderableSlots(stage, granularityMin)) {
        if (slotMs < rangeStart || slotMs >= rangeEnd) {
          failures.push(
            `${label}: slot ${new Date(slotMs).toISOString()} starts outside [${range.start} .. ${range.end}]`
          )
          break
        }
      }
    }

    expect(failures, failures.slice(0, 10).join('\n')).toEqual([])
  })
})
