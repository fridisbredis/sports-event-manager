import { describe, it, expect } from 'vitest'
import { ANNOUNCEMENTS_PAGE_SIZE, parsePageParam, pageRange, splitPage } from './pagination'

describe('parsePageParam', () => {
  it('defaults to page 1 when the param is absent', () => {
    expect(parsePageParam(undefined)).toBe(1)
  })

  it('accepts a positive integer', () => {
    expect(parsePageParam('3')).toBe(3)
  })

  // A stale link or a tampered URL must land on page 1 rather than throwing —
  // the same posture the scheduling grid takes with ?day= and ?stage=.
  it.each(['0', '-2', '1.5', 'abc', '', 'NaN'])('falls back to page 1 for %o', (raw) => {
    expect(parsePageParam(raw)).toBe(1)
  })

  it('clamps a page number past the cap instead of paging that deep', () => {
    expect(parsePageParam('999999')).toBe(500)
  })
})

describe('pageRange', () => {
  it('starts at row 0 for page 1', () => {
    expect(pageRange(1, 20)).toEqual({ from: 0, to: 20 })
  })

  it('offsets by whole pages', () => {
    expect(pageRange(3, 20)).toEqual({ from: 40, to: 60 })
  })

  // The range asks for one row past the page so hasMore needs no count query.
  it('requests one row past the page end', () => {
    const { from, to } = pageRange(1, 20)
    expect(to - from).toBe(20)
  })

  it('uses the announcements page size by default', () => {
    expect(pageRange(2)).toEqual({
      from: ANNOUNCEMENTS_PAGE_SIZE,
      to: ANNOUNCEMENTS_PAGE_SIZE * 2,
    })
  })
})

describe('splitPage', () => {
  it('reports no older page when the query returned a partial page', () => {
    expect(splitPage([1, 2, 3], 20)).toEqual({ items: [1, 2, 3], hasMore: false })
  })

  it('reports no older page when the query returned exactly one page', () => {
    const rows = Array.from({ length: 20 }, (_, i) => i)
    expect(splitPage(rows, 20)).toEqual({ items: rows, hasMore: false })
  })

  it('drops the sentinel row and reports an older page', () => {
    const rows = Array.from({ length: 21 }, (_, i) => i)
    const { items, hasMore } = splitPage(rows, 20)
    expect(items).toHaveLength(20)
    expect(items.at(-1)).toBe(19)
    expect(hasMore).toBe(true)
  })

  it('handles an empty result', () => {
    expect(splitPage([], 20)).toEqual({ items: [], hasMore: false })
  })
})

// pageRange and splitPage are only correct together: the range deliberately
// overlaps the next page's first index, because that row is the sentinel and
// splitPage drops it. Asserting the {from, to} literals alone cannot show
// that, so page through a fixture the way PostgREST would and check the rows
// that actually reach the render.
describe('pageRange + splitPage', () => {
  // `.range(from, to)` is inclusive on both ends.
  const fetchPage = (rows: number[], page: number, pageSize: number) => {
    const { from, to } = pageRange(page, pageSize)
    return splitPage(rows.slice(from, to + 1), pageSize)
  }

  const rows = Array.from({ length: 45 }, (_, i) => i)

  it('serves every row exactly once across consecutive pages', () => {
    const pages = [1, 2, 3].map((page) => fetchPage(rows, page, 20).items)

    expect(pages).toEqual([rows.slice(0, 20), rows.slice(20, 40), rows.slice(40, 45)])
    expect(pages.flat()).toEqual(rows)
    expect(new Set(pages.flat()).size).toBe(rows.length)
  })

  it('never repeats a row across a page boundary', () => {
    for (const page of [1, 2]) {
      const current = fetchPage(rows, page, 20).items
      const next = fetchPage(rows, page + 1, 20).items
      expect(current.filter((row) => next.includes(row))).toEqual([])
    }
  })

  it('reports an older page until the last one', () => {
    expect([1, 2, 3].map((page) => fetchPage(rows, page, 20).hasMore)).toEqual([true, true, false])
  })

  it('renders the past-the-end state rather than repeating the last page', () => {
    expect(fetchPage(rows, 4, 20)).toEqual({ items: [], hasMore: false })
  })

  it('reports no older page when the total is an exact multiple of the page size', () => {
    const exact = Array.from({ length: 40 }, (_, i) => i)

    expect(fetchPage(exact, 2, 20)).toEqual({ items: exact.slice(20, 40), hasMore: false })
  })
})
