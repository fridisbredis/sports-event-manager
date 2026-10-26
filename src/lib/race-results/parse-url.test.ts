import { describe, expect, it } from 'vitest'

import { parseRaceResultsEventId } from './parse-url'

describe('parseRaceResultsEventId', () => {
  // The input is whatever an admin pasted into the EVT-02 stage field, so
  // the shapes below are the realistic ones rather than a canonical URL.
  it.each([
    ['the form the public page produces', 'https://my.raceresult.com/361004/participants#0_66036E'],
    ['a bare event page', 'https://my.raceresult.com/361004/'],
    ['no scheme, as pasted from an address bar', 'my.raceresult.com/361004/'],
    ['no scheme and no trailing slash', 'my.raceresult.com/361004'],
    ['http rather than https', 'http://my.raceresult.com/361004/participants'],
    ['a regional server', 'https://my2.raceresult.com/361004/participants'],
    ['surrounding whitespace', '  https://my.raceresult.com/361004/  '],
    ['an uppercase host', 'https://MY.RACERESULT.COM/361004/'],
  ])('extracts the event id: %s', (_label, input) => {
    expect(parseRaceResultsEventId(input)).toBe('361004')
  })

  it('takes the event id from an API url, where later segments are also numeric', () => {
    // RRPublish/data/list carries no further digits, but a contest or page
    // number in a pasted deep link would. The FIRST numeric segment is the
    // event.
    expect(
      parseRaceResultsEventId('https://my2.raceresult.com/361004/RRPublish/data/list?contest=0')
    ).toBe('361004')
  })

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s', (_label, input) => {
    expect(parseRaceResultsEventId(input)).toBeNull()
  })

  it('rejects a link to another timing provider', () => {
    // Without the host check this would yield '361004' and then fail with a
    // confusing 404 from an API the admin never meant to call.
    expect(parseRaceResultsEventId('https://example.com/361004/participants')).toBeNull()
  })

  it('rejects a lookalike host that merely contains raceresult.com', () => {
    expect(parseRaceResultsEventId('https://raceresult.com.example.net/361004/')).toBeNull()
  })

  it('returns null for a raceresult url with no event id in it', () => {
    expect(parseRaceResultsEventId('https://my.raceresult.com/participants')).toBeNull()
  })

  it('returns null rather than throwing on unparseable input', () => {
    expect(parseRaceResultsEventId('ht!tp://%%%')).toBeNull()
  })
})
