import { describe, it, expect, vi, beforeEach } from 'vitest'

const addToast = vi.hoisted(() => vi.fn())
vi.mock('@heroui/react', () => ({ addToast }))

import { extractErrorMessage, parseRetryAfterMinutes, toastError, toastSuccess } from './toast'

function makeResponse(retryAfter?: string): Response {
  return {
    headers: {
      get: (name: string) => (name === 'Retry-After' ? (retryAfter ?? null) : null),
    },
  } as unknown as Response
}

describe('parseRetryAfterMinutes', () => {
  it('rounds a numeric Retry-After (seconds) up to whole minutes', () => {
    expect(parseRetryAfterMinutes(makeResponse('90'))).toBe(2)
    expect(parseRetryAfterMinutes(makeResponse('60'))).toBe(1)
    expect(parseRetryAfterMinutes(makeResponse('1'))).toBe(1)
  })

  it('falls back to 60 seconds (1 minute) when the header is missing', () => {
    expect(parseRetryAfterMinutes(makeResponse())).toBe(1)
  })

  it('falls back to 60 seconds when the header is not a positive number', () => {
    expect(parseRetryAfterMinutes(makeResponse('0'))).toBe(1)
    expect(parseRetryAfterMinutes(makeResponse('-30'))).toBe(1)
    expect(parseRetryAfterMinutes(makeResponse('not-a-number'))).toBe(1)
  })
})

describe('extractErrorMessage', () => {
  const fallback = 'Something went wrong'

  it('returns a plain string error as-is', () => {
    expect(extractErrorMessage({ error: 'Event not found' }, fallback)).toBe('Event not found')
  })

  it('prefers the first formErrors entry of a flatten object', () => {
    const body = {
      error: {
        formErrors: ['Start must be before end', 'ignored'],
        fieldErrors: { name: ['Name is required'] },
      },
    }
    expect(extractErrorMessage(body, fallback)).toBe('Start must be before end')
  })

  it('falls through to the first non-empty fieldErrors entry when formErrors is absent', () => {
    const body = {
      error: {
        fieldErrors: { name: [], startsAt: ['Invalid date'], endsAt: ['Also invalid'] },
      },
    }
    expect(extractErrorMessage(body, fallback)).toBe('Invalid date')
  })

  it('skips a null fieldErrors value and takes the next populated one', () => {
    const body = {
      error: {
        fieldErrors: { name: null, startsAt: ['Invalid date'] } as unknown as Record<
          string,
          string[]
        >,
      },
    }
    expect(extractErrorMessage(body, fallback)).toBe('Invalid date')
  })

  it('returns the fallback when the flatten object has neither key', () => {
    expect(extractErrorMessage({ error: {} }, fallback)).toBe(fallback)
  })

  it('returns the fallback when every fieldErrors array is empty', () => {
    const body = { error: { formErrors: [], fieldErrors: { name: [], startsAt: [] } } }
    expect(extractErrorMessage(body, fallback)).toBe(fallback)
  })

  it('returns the fallback when the body is missing or has no error key', () => {
    expect(extractErrorMessage(undefined, fallback)).toBe(fallback)
    expect(extractErrorMessage(null, fallback)).toBe(fallback)
    expect(extractErrorMessage({}, fallback)).toBe(fallback)
    expect(extractErrorMessage({ message: 'nope' }, fallback)).toBe(fallback)
  })

  it('returns the fallback when the error is a non-object primitive', () => {
    expect(extractErrorMessage({ error: 500 }, fallback)).toBe(fallback)
    expect(extractErrorMessage({ error: true }, fallback)).toBe(fallback)
  })
})

describe('toastError / toastSuccess', () => {
  beforeEach(() => {
    addToast.mockClear()
  })

  it('sends a danger toast with a 5s timeout', () => {
    toastError('Could not save the event', 'Save failed')

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith({
      title: 'Save failed',
      description: 'Could not save the event',
      color: 'danger',
      timeout: 5000,
    })
  })

  it('sends a success toast with a 3s timeout', () => {
    toastSuccess('Event saved', 'Done')

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith({
      title: 'Done',
      description: 'Event saved',
      color: 'success',
      timeout: 3000,
    })
  })

  it('leaves the title undefined when it is omitted', () => {
    toastError('Could not save the event')
    toastSuccess('Event saved')

    expect(addToast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ title: undefined, description: 'Could not save the event' })
    )
    expect(addToast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ title: undefined, description: 'Event saved' })
    )
  })
})
