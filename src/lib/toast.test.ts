import { describe, it, expect } from 'vitest'
import { parseRetryAfterMinutes } from './toast'

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
