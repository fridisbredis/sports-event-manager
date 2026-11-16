import { describe, it, expect } from 'vitest'

import { assessSlots, parseBlobList, STALE_AFTER_DAYS, type WeeklySlot } from './weekly-slots'

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
