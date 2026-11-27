import { describe, it, expect } from 'vitest'

import { parseFeedbackOrigin } from './origin'

const EVENT_ID = '2b8e4d4a-9c61-4e5b-8f2a-9d107f3c1a52'

describe('parseFeedbackOrigin', () => {
  it('keeps an in-app path and an event uuid', () => {
    expect(parseFeedbackOrigin({ from: '/club/admin/events/x', event: EVENT_ID })).toEqual({
      fromPath: '/club/admin/events/x',
      eventId: EVENT_ID,
    })
  })

  it.each([
    ['a full URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/x'],
    ['a relative path', 'club/admin'],
    ['an over-long path', '/' + 'x'.repeat(600)],
  ])('drops %s as the origin', (_label, from) => {
    expect(parseFeedbackOrigin({ from }).fromPath).toBeNull()
  })

  it('drops an event that is not a uuid', () => {
    expect(parseFeedbackOrigin({ event: 'e1' }).eventId).toBeNull()
  })

  it('takes the first value of a repeated parameter, and copes with none', () => {
    expect(parseFeedbackOrigin({ from: ['/a', '/b'] }).fromPath).toBe('/a')
    expect(parseFeedbackOrigin({})).toEqual({ fromPath: null, eventId: null })
  })
})
