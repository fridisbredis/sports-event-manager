import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logger } from '@/lib/logger'
import { checkReadCeiling } from './bounded-read'

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkReadCeiling', () => {
  it('returns all rows and does not log when under the ceiling', () => {
    const rows = [1, 2, 3]

    const result = checkReadCeiling(rows, {
      ceiling: 5,
      page: 'test/page',
      message: 'ceiling hit',
    })

    expect(result).toEqual([1, 2, 3])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('does not log when exactly at the ceiling', () => {
    const rows = [1, 2, 3]

    const result = checkReadCeiling(rows, {
      ceiling: 3,
      page: 'test/page',
      message: 'ceiling hit',
    })

    expect(result).toEqual([1, 2, 3])
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs and slices to the ceiling when the ceiling is exceeded', () => {
    const rows = [1, 2, 3, 4]

    const result = checkReadCeiling(rows, {
      ceiling: 3,
      page: 'test/page',
      message: 'ceiling hit',
      context: { tenantId: 'tenant-1' },
    })

    expect(result).toEqual([1, 2, 3])
    expect(logger.warn).toHaveBeenCalledWith('ceiling hit', {
      ceiling: 3,
      page: 'test/page',
      tenantId: 'tenant-1',
    })
  })
})
