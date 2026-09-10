import { expect } from 'vitest'
import type { Mock } from 'vitest'

/**
 * Shared assertion for the `.range(0, ceiling)` shape that every
 * `checkReadCeiling`-guarded read wires up. Pins the ceiling constant used in
 * the page source to the value the test expects, so the two can't drift
 * silently.
 */
export function expectRangeCeiling(builder: Record<string, unknown>, ceiling: number): void {
  expect(builder.range as Mock).toHaveBeenCalledWith(0, ceiling)
}

interface ExpectReadCeilingWarnOptions {
  ceiling: number
  page: string
  context?: Record<string, unknown>
}

/**
 * Shared assertion for the `logger.warn` call `checkReadCeiling` makes when a
 * read breaches its ceiling. Pins the warn message shape and the
 * ceiling/page/context fields without pinning the exact message wording.
 */
export function expectReadCeilingWarn(warnMock: Mock, opts: ExpectReadCeilingWarnOptions): void {
  expect(warnMock).toHaveBeenCalledWith(
    expect.stringContaining('read ceiling'),
    expect.objectContaining({
      ceiling: opts.ceiling,
      page: opts.page,
      ...opts.context,
    })
  )
}
