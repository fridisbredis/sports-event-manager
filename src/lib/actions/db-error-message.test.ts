import { describe, it, expect, vi } from 'vitest'
import { translateDbError, translateStorageError } from './db-error-message'

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

// F-REL-22: these are the only call sites where a raw Postgres/PostgREST/
// Storage error.message could otherwise reach the client — every actions.ts
// file routes through this helper instead of returning error.message
// directly. Assert the mapping table itself here rather than duplicating it
// per call site.
describe('translateDbError', () => {
  it('maps P0002 to the not-found message', async () => {
    const result = await translateDbError('test', { code: 'P0002', message: 'raw pg message' })
    expect(result).toBe('This event could not be found. Refresh the page and try again.')
  })

  it('maps P0003 to the Race-stage-specific message', async () => {
    const result = await translateDbError('test', { code: 'P0003', message: 'raw pg message' })
    expect(result).toBe('Cannot remove the last Race stage from a published event.')
  })

  it('maps 23514 to the stage-times message', async () => {
    const result = await translateDbError('test', { code: '23514', message: 'raw pg message' })
    expect(result).toBe("A stage's end time must be after its start time.")
  })

  it('falls back to the generic save error for an unmapped code', async () => {
    const result = await translateDbError('test', { code: 'XXXXX', message: 'db is down' })
    expect(result).toBe('Something went wrong while saving. Please try again.')
  })

  it('falls back to a caller-supplied key when given one', async () => {
    const result = await translateDbError(
      'test',
      { code: 'XXXXX', message: 'db is down' },
      'workstations.genericDeleteError'
    )
    expect(result).toBe('Something went wrong while deleting. Please try again.')
  })

  it('never returns the raw error message for any code', async () => {
    const codes = ['P0002', 'P0003', '23514', undefined, 'XXXXX']
    for (const code of codes) {
      const result = await translateDbError('test', { code, message: 'super secret db internals' })
      expect(result).not.toContain('super secret db internals')
    }
  })

  // publish_event's 23514 means something different than sync_event_stages'
  // 23514 (DB_ERROR_KEYS' default) — codeOverrides lets a call site redirect
  // a code DB_ERROR_KEYS already maps, not just add a code it's missing.
  it('lets a caller-supplied codeOverrides redirect a code DB_ERROR_KEYS already maps', async () => {
    const result = await translateDbError(
      'test',
      { code: '23514', message: 'raw pg message' },
      'eventConfig.genericSaveError',
      { '23514': 'eventConfig.cannotPublishNoRaceStage' }
    )
    expect(result).toBe('Add at least one Race stage before publishing.')
  })

  it('still uses DB_ERROR_KEYS for a code codeOverrides does not mention', async () => {
    const result = await translateDbError(
      'test',
      { code: 'P0002', message: 'raw pg message' },
      'eventConfig.genericSaveError',
      { '23514': 'eventConfig.cannotPublishNoRaceStage' }
    )
    expect(result).toBe('This event could not be found. Refresh the page and try again.')
  })
})

describe('translateStorageError', () => {
  it('always returns the generic upload error message, never the raw message', async () => {
    const result = await translateStorageError('test', { message: 'S3 bucket unreachable' })
    expect(result).toBe('Something went wrong while uploading the logo. Please try again.')
  })
})
