import { describe, expect, it } from 'vitest'

import listFixture from './__fixtures__/list-361004.json'
import { normaliseNation, parseParticipantList } from './parse'

describe('normaliseNation', () => {
  it('extracts the country code from the flag image reference the API returns', () => {
    // This is the real shape: the API sends an image path, not a code.
    // Storing it raw would show '[img:/graphics/flags/IS.svg]' in a column
    // headed "Nation".
    expect(normaliseNation('[img:/graphics/flags/IS.svg]')).toBe('IS')
    expect(normaliseNation('[img:/graphics/flags/SE.svg]')).toBe('SE')
  })

  it('passes through a value that is already a country code', () => {
    expect(normaliseNation('SE')).toBe('SE')
    expect(normaliseNation('swe')).toBe('SWE')
  })

  it.each([
    ['an empty string', ''],
    ['whitespace', '  '],
    ['null', null],
    ['undefined', undefined],
  ])('returns null for %s', (_label, input) => {
    expect(normaliseNation(input)).toBeNull()
  })

  it('returns null rather than storing markup it does not recognise', () => {
    expect(normaliseNation('[img:/graphics/flags/unknown.png]')).toBeNull()
  })
})

describe('parseParticipantList', () => {
  // The fixture is a real response from event 361004 (Viadal Ultra Six Days
  // 2026), captured 2026-10-26, trimmed to six rows but with its field
  // definitions and value shapes untouched.
  it('parses the committed fixture of a real response', () => {
    const { participants, skipped } = parseParticipantList(listFixture)

    expect(skipped).toBe(0)
    expect(participants).toHaveLength(6)
  })

  it('maps every core field of a real row', () => {
    const { participants } = parseParticipantList(listFixture)
    const first = participants[0]

    expect(first).toEqual({
      externalId: '16',
      bib: '1',
      name: 'Höskuldur Kristvinsson',
      nation: 'IS',
      gender: 'M',
      category: 'M75',
      club: 'Náttúruhlaup',
      extra: {},
    })
  })

  it('keeps externalId distinct from bib', () => {
    // The two really are different identities in this data: bib 1 is ID 16.
    // Keying the upsert on bib would be wrong, and this asserts the parser
    // never conflates them.
    const { participants } = parseParticipantList(listFixture)

    expect(participants[0].bib).toBe('1')
    expect(participants[0].externalId).toBe('16')
    expect(participants.map((p) => p.externalId)).toEqual(expect.arrayContaining(['16', '22', '4']))
  })

  it('reads fields by name, not by position', () => {
    // The same values in a different column order must parse identically.
    // Hard-coded indices would pass against the fixture and silently
    // mis-assign columns for a race configured differently — names landing
    // in the club column, with nothing to indicate a fault.
    const reordered = {
      DataFields: ['CLUB', 'AGEGROUP.NAME', 'KönM/K', 'NATION.FLAG', 'FLNAME', 'ID', 'BIB'],
      data: {
        '#1_x': [
          [
            'Náttúruhlaup',
            'M75',
            'M',
            '[img:/graphics/flags/IS.svg]',
            'Höskuldur Kristvinsson',
            '16',
            '1',
          ],
        ],
      },
    }

    const { participants } = parseParticipantList(reordered)

    expect(participants[0]).toEqual({
      externalId: '16',
      bib: '1',
      name: 'Höskuldur Kristvinsson',
      nation: 'IS',
      gender: 'M',
      category: 'M75',
      club: 'Náttúruhlaup',
      extra: {},
    })
  })

  it('accepts the ASCII spelling of the gender field', () => {
    // The live response spells it 'KönM/K'. The spike wrote 'KonM/K'. Both
    // are accepted rather than betting on one.
    const { participants } = parseParticipantList({
      DataFields: ['ID', 'KonM/K'],
      data: { '#1_x': [['7', 'K']] },
    })

    expect(participants[0].gender).toBe('K')
  })

  it('puts unmapped fields in extra rather than dropping them', () => {
    // The card: "Remaining Race Results fields stored as 'other' and shown
    // read-only". The field set differs between races, so this is the
    // column that absorbs the difference.
    const { participants } = parseParticipantList({
      DataFields: ['ID', 'FLNAME', 'TEAM', 'LICENSE'],
      data: { '#1_x': [['7', 'Anna Svensson', 'Team Alpha', 'SWE-123']] },
    })

    expect(participants[0].extra).toEqual({ TEAM: 'Team Alpha', LICENSE: 'SWE-123' })
  })

  it('treats empty strings as absent rather than storing them', () => {
    // A real row in the fixture has an empty club. An empty string in the
    // column would be a false value, not "unknown".
    const { participants } = parseParticipantList({
      DataFields: ['ID', 'FLNAME', 'CLUB', 'TEAM'],
      data: { '#1_x': [['7', 'Anna Svensson', '', '']] },
    })

    expect(participants[0].club).toBeNull()
    expect(participants[0].extra).toEqual({})
  })

  it('skips rows with no usable ID and reports how many', () => {
    // A row with no upsert key cannot be matched on re-import, so it would
    // be duplicated on every run. Skipping is right; skipping SILENTLY is
    // the F-REL-10 failure — a short list that looks plausible.
    const { participants, skipped } = parseParticipantList({
      DataFields: ['ID', 'FLNAME'],
      data: {
        '#1_x': [
          ['7', 'Anna'],
          ['', 'No Id'],
          ['9', 'Bo'],
        ],
      },
    })

    expect(participants.map((p) => p.externalId)).toEqual(['7', '9'])
    expect(skipped).toBe(1)
  })

  it('flattens the display grouping, since the stage comes from the link fetched', () => {
    const { participants } = parseParticipantList({
      DataFields: ['ID', 'FLNAME'],
      data: { '#1_Contest A': [['7', 'Anna']], '#2_Contest B': [['9', 'Bo']] },
    })

    expect(participants.map((p) => p.externalId)).toEqual(['7', '9'])
  })

  it.each([
    ['no DataFields', { data: { '#1_x': [['7']] } }],
    ['empty DataFields', { DataFields: [], data: { '#1_x': [['7']] } }],
    ['no data', { DataFields: ['ID'] }],
    ['data is an array, not an object', { DataFields: ['ID'], data: [['7']] }],
    ['an empty object', {}],
  ])('returns an empty result rather than throwing for %s', (_label, input) => {
    expect(() => parseParticipantList(input)).not.toThrow()
    expect(parseParticipantList(input).participants).toEqual([])
  })
})
