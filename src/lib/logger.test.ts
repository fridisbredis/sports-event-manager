import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureException = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}))

import { logger } from './logger'

// The shape supabase-js returns: a plain object, not an Error instance.
const postgrestError = {
  message: 'TypeError: fetch failed',
  details: 'Caused by: Error: getaddrinfo EAI_AGAIN example.supabase.co',
  hint: '',
  code: '',
}

describe('logger.error → Sentry', () => {
  beforeEach(() => {
    captureException.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends the details of a non-Error object in extra (B25)', () => {
    logger.error('SMS worker failed to claim queue batch', postgrestError, { batch: 25 })

    expect(captureException).toHaveBeenCalledTimes(1)
    const [reported, hint] = captureException.mock.calls[0]
    // Still grouped by the log message, so existing Sentry issues keep collecting events.
    expect(reported).toBeInstanceOf(Error)
    expect((reported as Error).message).toBe('SMS worker failed to claim queue batch')
    expect(hint.extra).toEqual({
      message: 'SMS worker failed to claim queue batch',
      batch: 25,
      error: postgrestError,
    })
  })

  it('masks E.164 phone numbers in the error sent to Sentry, but not in stdout', () => {
    const conflict = {
      message: 'duplicate key value violates unique constraint "officials_tenant_phone_key"',
      details:
        'Key (tenant_id, phone)=(9b2c4f1e-0d5a-4c7b-8e21-3f6a9d0c1b2e, +46701234567) already exists.',
      hint: null,
      code: '23505',
    }

    logger.error('Insert failed', conflict)

    const [, hint] = captureException.mock.calls[0]
    expect(hint.extra.error).toEqual({
      ...conflict,
      details:
        'Key (tenant_id, phone)=(9b2c4f1e-0d5a-4c7b-8e21-3f6a9d0c1b2e, [phone]) already exists.',
    })
    // The container log keeps the full value: it stays in our own Log Analytics.
    expect(vi.mocked(console.error).mock.calls[0][0]).toContain('+46701234567')
  })

  it('reports an Error instance as itself, without duplicating it in extra', () => {
    const err = new Error('boom')

    logger.error('Something failed', err, { tenantId: 't1' })

    const [reported, hint] = captureException.mock.calls[0]
    expect(reported).toBe(err)
    expect(hint.extra).toEqual({ message: 'Something failed', tenantId: 't1' })
  })

  it('reports a primitive as its string form', () => {
    logger.error('Something failed', 'just a string')

    const [, hint] = captureException.mock.calls[0]
    expect(hint.extra.error).toEqual({ message: 'just a string' })
  })

  it('adds no error key when no error is given', () => {
    logger.error('Something failed')

    const [, hint] = captureException.mock.calls[0]
    expect(hint.extra).toEqual({ message: 'Something failed' })
  })

  it('never throws when the Sentry SDK does', () => {
    captureException.mockImplementation(() => {
      throw new Error('sdk down')
    })

    expect(() => logger.error('Something failed', postgrestError)).not.toThrow()
  })
})
