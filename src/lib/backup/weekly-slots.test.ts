import { describe, it, expect } from 'vitest'

import {
  assessSlots,
  isoWeekOf,
  parseBlobList,
  STALE_AFTER_DAYS,
  weekCoverage,
  type WeeklySlot,
} from './weekly-slots'

function blob(name: string, opts: { capturedat?: string; isoweek?: string; modified?: string }) {
  const meta = [
    opts.capturedat ? `<capturedat>${opts.capturedat}</capturedat>` : '',
    opts.isoweek ? `<isoweek>${opts.isoweek}</isoweek>` : '',
    '<source>weekly-db-backup</source>',
  ].join('')
  return `<Blob><Name>${name}</Name><Properties><Last-Modified>${
    opts.modified ?? 'Sun, 01 Nov 2026 10:37:36 GMT'
  }</Last-Modified><Content-Length>1048862</Content-Length></Properties><Metadata>${meta}</Metadata></Blob>`
}

function listXml(...blobs: string[]) {
  return `<?xml version="1.0" encoding="utf-8"?><EnumerationResults ContainerName="db-snapshots"><Prefix>weekly-slot</Prefix><Blobs>${blobs.join(
    ''
  )}</Blobs><NextMarker /></EnumerationResults>`
}

function slot(name: string, iso: string, isoWeek: number | null = null): WeeklySlot {
  return { name, capturedAt: new Date(iso), isoWeek }
}

describe('parseBlobList', () => {
  it('reads name, capturedat and isoweek from each blob', () => {
    const slots = parseBlobList(
      listXml(
        blob('weekly-slot-0.tar.gz', { capturedat: '2026-11-01T10:37:35Z', isoweek: '44' }),
        blob('weekly-slot-3.tar.gz', { capturedat: '2026-10-25T08:33:11Z', isoweek: '43' })
      )
    )

    expect(slots).toEqual([
      slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z', 44),
      slot('weekly-slot-3.tar.gz', '2026-10-25T08:33:11Z', 43),
    ])
  })

  it('falls back to Last-Modified when the blob has no capturedat', () => {
    const [only] = parseBlobList(
      listXml(blob('weekly-slot-1.tar.gz', { modified: 'Sun, 08 Nov 2026 10:31:00 GMT' }))
    )

    expect(only.capturedAt.toISOString()).toBe('2026-11-08T10:31:00.000Z')
    expect(only.isoWeek).toBeNull()
  })

  it('skips a blob whose date cannot be read rather than guessing', () => {
    const slots = parseBlobList(
      listXml(blob('weekly-slot-2.tar.gz', { capturedat: 'not a date', modified: 'garbage' }))
    )

    expect(slots).toEqual([])
  })

  it('returns nothing for an empty container', () => {
    expect(parseBlobList(listXml())).toEqual([])
  })
})

describe('assessSlots', () => {
  it('is fresh the day after a normal Sunday run', () => {
    const result = assessSlots(
      [
        slot('weekly-slot-3.tar.gz', '2026-10-25T08:33:11Z'),
        slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z'),
      ],
      new Date('2026-11-02T04:00:00Z')
    )

    expect(result.stale).toBe(false)
    expect(result.newest?.name).toBe('weekly-slot-0.tar.gz')
    expect(result.slots.map((s) => s.name)).toEqual([
      'weekly-slot-0.tar.gz',
      'weekly-slot-3.tar.gz',
    ])
    expect(result.gaps).toEqual([])
  })

  it('is stale the Monday after a missed Sunday — the 2026-11-08 failure', () => {
    const result = assessSlots(
      [slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z')],
      new Date('2026-11-09T04:00:00Z')
    )

    expect(result.newestAgeDays).toBeGreaterThan(STALE_AFTER_DAYS)
    expect(result.stale).toBe(true)
  })

  it('is not stale on the Sunday morning before the job runs late', () => {
    // Newest from last Sunday 10:37; check runs this Sunday 04:00 — 6.7 days.
    const result = assessSlots(
      [slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z')],
      new Date('2026-11-08T04:00:00Z')
    )

    expect(result.stale).toBe(false)
  })

  it('is stale when there are no slots at all', () => {
    const result = assessSlots([], new Date('2026-11-16T04:00:00Z'))

    expect(result.stale).toBe(true)
    expect(result.newest).toBeNull()
    expect(result.newestAgeDays).toBeNull()
  })

  it('reports a gap where weeks are missing between slots', () => {
    // The state on 2026-11-16 had the job been fixed and dispatched that day.
    const result = assessSlots(
      [
        slot('weekly-slot-3.tar.gz', '2026-11-16T13:00:00Z'),
        slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z'),
      ],
      new Date('2026-11-17T04:00:00Z')
    )

    expect(result.stale).toBe(false)
    expect(result.gaps).toEqual([
      { after: 'weekly-slot-0.tar.gz', before: 'weekly-slot-3.tar.gz', days: 15.1 },
    ])
  })
})

describe('isoWeekOf', () => {
  it.each([
    ['2026-11-22T11:37:00Z', 2026, 47], // Sunday: last day of its ISO week
    ['2026-11-16T13:38:00Z', 2026, 47], // Monday: first day of the same week
    ['2026-01-01T12:00:00Z', 2026, 1], // a Thursday, so week 1 of its own year
    ['2027-01-03T10:00:00Z', 2026, 53], // 2026 has 53 ISO weeks
    ['2027-01-10T10:00:00Z', 2027, 1],
    ['2024-12-30T10:00:00Z', 2025, 1], // a Monday in December belonging to next ISO year
  ])('%s is ISO %i-W%i', (iso, year, week) => {
    expect(isoWeekOf(new Date(iso))).toEqual({ year, week })
  })
})

describe('weekCoverage', () => {
  const weeksOf = (c: ReturnType<typeof weekCoverage>) =>
    c.weeks.map((w) => [w.week, w.slot?.name ?? null])

  it('names the missing weeks in the state the 2026-11 drill found (slots for weeks 44 and 47 only)', () => {
    const slots = [
      slot('weekly-slot-0.tar.gz', '2026-11-01T10:37:35Z', 44),
      slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47),
    ]

    const coverage = weekCoverage(slots, new Date('2026-11-24T12:00:00Z'))

    expect(weeksOf(coverage)).toEqual([
      [47, 'weekly-slot-3.tar.gz'],
      [46, null],
      [45, null],
      [44, 'weekly-slot-0.tar.gz'],
    ])
    expect(coverage.older).toEqual([])
  })

  it('covers all four weeks after a healthy rotation', () => {
    const slots = [
      slot('weekly-slot-0.tar.gz', '2026-11-29T10:30:00Z', 48),
      slot('weekly-slot-1.tar.gz', '2026-12-06T10:30:00Z', 49),
      slot('weekly-slot-2.tar.gz', '2026-12-13T10:30:00Z', 50),
      slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47),
    ]

    const coverage = weekCoverage(slots, new Date('2026-12-15T09:00:00Z'))

    expect(weeksOf(coverage)).toEqual([
      [50, 'weekly-slot-2.tar.gz'],
      [49, 'weekly-slot-1.tar.gz'],
      [48, 'weekly-slot-0.tar.gz'],
      [47, 'weekly-slot-3.tar.gz'],
    ])
  })

  it("does not call this Sunday's run missing before it has had time to land", () => {
    const slots = [slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47)]

    // Sunday 2026-11-29, 08:00 UTC: week 48's run is scheduled but GitHub often starts it late.
    const coverage = weekCoverage(slots, new Date('2026-11-29T08:00:00Z'))

    expect(coverage.weeks[0].week).toBe(47)
  })

  it('calls the run missing once Monday noon has passed without it', () => {
    const slots = [slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47)]

    const coverage = weekCoverage(slots, new Date('2026-11-30T13:00:00Z'))

    expect(weeksOf(coverage)[0]).toEqual([48, null])
  })

  it('starts the window at a manual run that is ahead of the schedule', () => {
    // workflow_dispatch on Monday 2026-11-16 writes ISO week 47 before week 47's Sunday.
    const slots = [slot('weekly-slot-3.tar.gz', '2026-11-16T13:38:24Z', 47)]

    const coverage = weekCoverage(slots, new Date('2026-11-17T09:00:00Z'))

    expect(weeksOf(coverage)[0]).toEqual([47, 'weekly-slot-3.tar.gz'])
  })

  it('lists a slot left over from before the window as older, not as a covered week', () => {
    const slots = [
      slot('weekly-slot-3.tar.gz', '2026-11-22T11:38:40Z', 47),
      slot('weekly-slot-1.tar.gz', '2026-10-11T10:00:00Z', 41),
    ]

    const coverage = weekCoverage(slots, new Date('2026-11-24T12:00:00Z'))

    expect(coverage.weeks.map((w) => w.slot?.name ?? null)).toEqual([
      'weekly-slot-3.tar.gz',
      null,
      null,
      null,
    ])
    expect(coverage.older.map((s) => s.name)).toEqual(['weekly-slot-1.tar.gz'])
  })

  it("does not mistake last year's week for this year's", () => {
    // Same week number, a year apart: the isoweek tag alone would match it.
    const slots = [slot('weekly-slot-3.tar.gz', '2025-11-23T10:00:00Z', 47)]

    const coverage = weekCoverage(slots, new Date('2026-11-24T12:00:00Z'))

    expect(coverage.weeks[0]).toMatchObject({ year: 2026, week: 47, slot: null })
    expect(coverage.older.map((s) => s.name)).toEqual(['weekly-slot-3.tar.gz'])
  })

  it('shows week 53 as gone once week 1 has overwritten its slot (both are slot 1)', () => {
    // 53 % 4 === 1 % 4: the rotation has no room for a 53-week year.
    const slots = [
      slot('weekly-slot-0.tar.gz', '2026-12-27T10:00:00Z', 52),
      slot('weekly-slot-1.tar.gz', '2027-01-10T10:00:00Z', 1),
      slot('weekly-slot-2.tar.gz', '2026-12-13T10:00:00Z', 50),
      slot('weekly-slot-3.tar.gz', '2026-12-20T10:00:00Z', 51),
    ]

    const coverage = weekCoverage(slots, new Date('2027-01-12T09:00:00Z'))

    expect(weeksOf(coverage)).toEqual([
      [1, 'weekly-slot-1.tar.gz'],
      [53, null],
      [52, 'weekly-slot-0.tar.gz'],
      [51, 'weekly-slot-3.tar.gz'],
    ])
    expect(coverage.older.map((s) => s.name)).toEqual(['weekly-slot-2.tar.gz'])
  })

  it('reports four missing weeks for an empty container', () => {
    const coverage = weekCoverage([], new Date('2026-11-24T12:00:00Z'))

    expect(coverage.weeks.map((w) => w.slot)).toEqual([null, null, null, null])
    expect(coverage.weeks.map((w) => w.week)).toEqual([47, 46, 45, 44])
  })
})
