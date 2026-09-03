import { z } from 'zod'

/**
 * Rows per page for the announcement timelines (PERF-06).
 *
 * Deliberately small. PERF-01 established that the binding constraint is
 * SSR CPU per request, not database time — the replica reads 102% of its
 * 0.5 vCPU limit under the derived load — so a larger first page costs the
 * scarce resource and saves the plentiful one. A bigger page would also
 * mean the `hasMore` path almost never fires in real use.
 */
export const ANNOUNCEMENTS_PAGE_SIZE = 20

/**
 * Deep offsets are the only way a page number can cost anything, so cap it.
 * 500 pages of 20 is far past any real timeline; past the end the page
 * renders its "no older announcements" state rather than an error.
 */
const MAX_PAGE = 500

const pageSchema = z.coerce.number().int().min(1).catch(1)

/**
 * 1-based page number from an untrusted `?page=` value. Anything that is not
 * a positive integer falls back to page 1, and anything past the cap is
 * clamped to it — the same posture the scheduling grid takes with
 * `?day=`/`?stage=`: a stale or tampered link must land somewhere sensible,
 * not on an error page.
 */
export function parsePageParam(raw: string | undefined): number {
  return Math.min(pageSchema.parse(raw ?? 1), MAX_PAGE)
}

/**
 * PostgREST range for a page, requesting one row past its end. That extra row
 * is never rendered — it only answers "is there an older page", which avoids a
 * second `count` round trip. Same sentinel trick the bounded admin reads use
 * for their 500-row ceiling.
 */
export function pageRange(page: number, pageSize: number = ANNOUNCEMENTS_PAGE_SIZE) {
  const from = (page - 1) * pageSize
  return { from, to: from + pageSize }
}

/**
 * Splits a `pageRange` result into the rows to render and whether an older
 * page exists. Pass the rows exactly as the query returned them.
 */
export function splitPage<T>(
  rows: T[],
  pageSize: number = ANNOUNCEMENTS_PAGE_SIZE
): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, pageSize), hasMore: rows.length > pageSize }
}
