import { logger } from '@/lib/logger'

interface BoundedReadOptions {
  ceiling: number
  page: string
  message: string
  context?: Record<string, unknown>
}

/**
 * Guard-rail for a `.range(0, ceiling)` read: warns if the ceiling was hit
 * (one row past `ceiling` came back) and returns the rows capped to
 * `ceiling`. Not pagination — for a list the user browses, use
 * `src/lib/pagination.ts` instead.
 */
export function checkReadCeiling<T>(rows: T[], opts: BoundedReadOptions): T[] {
  if (rows.length > opts.ceiling) {
    logger.warn(opts.message, {
      ceiling: opts.ceiling,
      page: opts.page,
      ...opts.context,
    })
  }
  return rows.slice(0, opts.ceiling)
}
