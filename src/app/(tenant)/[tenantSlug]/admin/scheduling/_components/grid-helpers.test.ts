import { describe, it, expect } from 'vitest'
import {
  toLocalAssignments,
  getAssignmentsForCell,
  getOverflowBySlot,
  applyCellAction,
  resolveCellActionLabel,
} from './grid-helpers'
import type { LocalAssignment } from './scheduling-types'

function makeAssignment(overrides: Partial<LocalAssignment> = {}): LocalAssignment {
  return {
    id: 'a1',
    official_id: 'o1',
    workstation_id: 'ws-1',
    timeslot_start: '2026-08-10T08:00:00.000Z',
    timeslot_end: '2026-08-10T08:30:00.000Z',
    status: 'assigned',
    slot_index: 1,
    ...overrides,
  }
}

describe('toLocalAssignments', () => {
  it('maps an inserted row to a local assignment, deriving timeslot_end from granularity', () => {
    const inserted = [
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-10T08:00:00.000Z',
        slot_index: 1,
      },
    ]

    const result = toLocalAssignments(inserted, 30)

    expect(result).toEqual([
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-10T08:00:00.000Z',
        timeslot_end: '2026-08-10T08:30:00.000Z',
        status: 'assigned',
        slot_index: 1,
      },
    ])
  })

  it('maps multiple inserted rows independently', () => {
    const inserted = [
      {
        id: 'a1',
        official_id: 'o1',
        workstation_id: 'ws-1',
        timeslot_start: '2026-08-10T08:00:00.000Z',
        slot_index: 1,
      },
      {
        id: 'a2',
        official_id: 'o2',
        workstation_id: 'ws-2',
        timeslot_start: '2026-08-10T09:00:00.000Z',
        slot_index: null,
      },
    ]

    const result = toLocalAssignments(inserted, 60)

    expect(result.map((r) => r.id)).toEqual(['a1', 'a2'])
    expect(result[1]).toEqual({
      id: 'a2',
      official_id: 'o2',
      workstation_id: 'ws-2',
      timeslot_start: '2026-08-10T09:00:00.000Z',
      timeslot_end: '2026-08-10T10:00:00.000Z',
      status: 'assigned',
      slot_index: null,
    })
  })

  it('returns an empty array for an empty input', () => {
    expect(toLocalAssignments([], 30)).toEqual([])
  })
})

describe('getAssignmentsForCell', () => {
  it('finds assignments for the given official and slot, regardless of work area', () => {
    const assignments = [
      makeAssignment({ id: 'a1', workstation_id: 'ws-1' }),
      makeAssignment({ id: 'a2', workstation_id: 'ws-2' }),
      makeAssignment({ id: 'a3', official_id: 'o2' }),
      makeAssignment({ id: 'a4', timeslot_start: '2026-08-10T09:00:00.000Z' }),
    ]

    const result = getAssignmentsForCell(assignments, 'o1', '2026-08-10T08:00:00.000Z')

    expect(result.map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('returns an empty array when there is no matching assignment', () => {
    const assignments = [makeAssignment()]

    expect(getAssignmentsForCell(assignments, 'o2', '2026-08-10T08:00:00.000Z')).toEqual([])
  })
})

describe('getOverflowBySlot', () => {
  it('groups assignments whose slot_index exceeds the capacity ceiling, by timeslot', () => {
    const assignments = [
      makeAssignment({ id: 'a1', slot_index: 1 }),
      makeAssignment({ id: 'a2', slot_index: 2 }),
      makeAssignment({ id: 'a3', slot_index: 3 }),
      makeAssignment({ id: 'a4', slot_index: 3, timeslot_start: '2026-08-10T09:00:00.000Z' }),
    ]

    const result = getOverflowBySlot(assignments, 'ws-1', 2)

    expect(Array.from(result.entries())).toEqual([
      ['2026-08-10T08:00:00.000Z', [assignments[2]]],
      ['2026-08-10T09:00:00.000Z', [assignments[3]]],
    ])
  })

  it('ignores assignments for other work areas', () => {
    const assignments = [makeAssignment({ workstation_id: 'ws-2', slot_index: 5 })]

    expect(getOverflowBySlot(assignments, 'ws-1', 1).size).toBe(0)
  })

  it('ignores assignments with a null slot_index', () => {
    const assignments = [makeAssignment({ slot_index: null })]

    expect(getOverflowBySlot(assignments, 'ws-1', 0).size).toBe(0)
  })

  it('returns an empty map when nothing exceeds the ceiling', () => {
    const assignments = [makeAssignment({ slot_index: 1 }), makeAssignment({ id: 'a2', slot_index: 2 })]

    expect(getOverflowBySlot(assignments, 'ws-1', 2).size).toBe(0)
  })
})

describe('applyCellAction', () => {
  it('removes the assignment matching the given id', () => {
    const assignments = [makeAssignment({ id: 'a1' }), makeAssignment({ id: 'a2' })]

    const result = applyCellAction(assignments, 'remove', 'a1')

    expect(result.map((a) => a.id)).toEqual(['a2'])
  })

  it('sets the status on the assignment matching the given id, leaving others untouched', () => {
    const assignments = [
      makeAssignment({ id: 'a1', status: 'pending' }),
      makeAssignment({ id: 'a2', status: 'pending' }),
    ]

    const result = applyCellAction(assignments, 'assigned', 'a1')

    expect(result[0].status).toBe('assigned')
    expect(result[1].status).toBe('pending')
  })

  it('is a no-op when no assignment matches the given id', () => {
    const assignments = [makeAssignment({ id: 'a1' })]

    expect(applyCellAction(assignments, 'remove', 'unknown')).toEqual(assignments)
  })
})

describe('resolveCellActionLabel', () => {
  const officials = [{ id: 'o1', name: 'Anna', invite_status: 'confirmed' }]
  const workstations = [
    {
      id: 'ws-1',
      name: 'Water Station',
      capacity_ceiling: 2,
      stage_id: null,
      workstation_operating_windows: [],
    },
  ]

  it('resolves the other official name when labelBy is "official" (overflow conflicts)', () => {
    const assignment = makeAssignment({ official_id: 'o1' })

    expect(resolveCellActionLabel('official', assignment, officials, workstations)).toBe('Anna')
  })

  it('resolves the work area name when labelBy is "workArea" (double-booking conflicts)', () => {
    const assignment = makeAssignment({ workstation_id: 'ws-1' })

    expect(resolveCellActionLabel('workArea', assignment, officials, workstations)).toBe('Water Station')
  })

  it('falls back to an em dash when the referenced official or work area is unknown', () => {
    const assignment = makeAssignment({ official_id: 'unknown', workstation_id: 'unknown' })

    expect(resolveCellActionLabel('official', assignment, officials, workstations)).toBe('—')
    expect(resolveCellActionLabel('workArea', assignment, officials, workstations)).toBe('—')
  })
})
