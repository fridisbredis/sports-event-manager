import { describe, it, expect } from 'vitest'
import {
  toLocalAssignments,
  getAssignmentsForCell,
  getOverflowBySlot,
  applyCellAction,
  resolveCellActionLabel,
  buildPickerCandidates,
  sortCandidates,
  hatchRunStyle,
  runEdgeClasses,
  SLOT_COLUMN_WIDTH_PX,
} from './grid-helpers'
import type { UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import type {
  LocalAssignment,
  OfficialData,
  PickerCandidate,
  PickerStatus,
} from './scheduling-types'

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
    const assignments = [
      makeAssignment({ slot_index: 1 }),
      makeAssignment({ id: 'a2', slot_index: 2 }),
    ]

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
  const officials = [{ id: 'o1', name: 'Anna', invite_status: 'confirmed', avatar_url: null }]
  const workstations = [
    {
      id: 'ws-1',
      name: 'Water Station',
      color: null,
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

    expect(resolveCellActionLabel('workArea', assignment, officials, workstations)).toBe(
      'Water Station'
    )
  })

  it('falls back to an em dash when the referenced official or work area is unknown', () => {
    const assignment = makeAssignment({ official_id: 'unknown', workstation_id: 'unknown' })

    expect(resolveCellActionLabel('official', assignment, officials, workstations)).toBe('—')
    expect(resolveCellActionLabel('workArea', assignment, officials, workstations)).toBe('—')
  })
})

describe('buildPickerCandidates', () => {
  const SLOT_A = '2026-08-10T08:00:00.000Z'
  const SLOT_B = '2026-08-10T08:30:00.000Z'

  function makeOfficial(id: string, name: string): OfficialData {
    return { id, name, invite_status: 'confirmed', avatar_url: null }
  }

  function makePeriod(
    officialId: string,
    role: 'official' | 'tenant_admin' = 'official'
  ): UnavailabilityPeriod {
    return {
      id: `p-${officialId}-${role}`,
      official_id: officialId,
      starts_at: SLOT_A,
      ends_at: SLOT_B,
      reason: null,
      created_by_role: role,
    }
  }

  it('marks an official free across every slot as available', () => {
    const officials = [makeOfficial('o1', 'Ada')]

    const result = buildPickerCandidates(officials, [SLOT_A, SLOT_B], [], new Map())

    expect(result).toEqual([{ official: officials[0], status: 'available' }])
  })

  // The bug this guards: the drag-paint picker offered people who had
  // declared time off, and the server then refused the pick with an error
  // the admin only saw after choosing. Time off has to block at the picker,
  // for a painted run exactly as it does for a single slot.
  it('blocks an official whose time off covers any slot in the run', () => {
    const officials = [makeOfficial('o1', 'Ada')]
    const periodsByCell = new Map([[`o1:${SLOT_B}`, [makePeriod('o1')]]])

    const result = buildPickerCandidates(officials, [SLOT_A, SLOT_B], [], periodsByCell)

    expect(result[0]!.status).toBe('timeOff')
  })

  it('distinguishes organiser-set time off from a self-declared one', () => {
    const officials = [makeOfficial('o1', 'Ada')]
    const periodsByCell = new Map([[`o1:${SLOT_A}`, [makePeriod('o1', 'tenant_admin')]]])

    const result = buildPickerCandidates(officials, [SLOT_A], [], periodsByCell)

    expect(result[0]!.status).toBe('timeOffAdmin')
  })

  it('marks an official already working any slot in the run as assigned', () => {
    const officials = [makeOfficial('o1', 'Ada')]
    const assignments = [makeAssignment({ official_id: 'o1', timeslot_start: SLOT_B })]

    const result = buildPickerCandidates(officials, [SLOT_A, SLOT_B], assignments, new Map())

    expect(result[0]!.status).toBe('assigned')
  })

  it('returns blocked officials rather than dropping them', () => {
    const officials = [makeOfficial('o1', 'Ada'), makeOfficial('o2', 'Bo')]
    const periodsByCell = new Map([[`o1:${SLOT_A}`, [makePeriod('o1')]]])

    const result = buildPickerCandidates(officials, [SLOT_A], [], periodsByCell)

    expect(result).toHaveLength(2)
  })
})

describe('sortCandidates', () => {
  function candidate(id: string, name: string, status: PickerStatus): PickerCandidate {
    return {
      official: { id, name, invite_status: 'confirmed', avatar_url: null },
      status,
    }
  }

  it('puts available people first and sorts by name within a status', () => {
    const sorted = sortCandidates([
      candidate('o1', 'Zoe', 'assigned'),
      candidate('o2', 'Bo', 'available'),
      candidate('o3', 'Ada', 'timeOff'),
      candidate('o4', 'Ada', 'available'),
    ])

    expect(sorted.map((c) => [c.official.name, c.status])).toEqual([
      ['Ada', 'available'],
      ['Bo', 'available'],
      ['Ada', 'timeOff'],
      ['Zoe', 'assigned'],
    ])
  })

  it('does not mutate the input', () => {
    const input = [candidate('o1', 'Zoe', 'assigned'), candidate('o2', 'Bo', 'available')]

    sortCandidates(input)

    expect(input.map((c) => c.official.name)).toEqual(['Zoe', 'Bo'])
  })
})

describe('runEdgeClasses', () => {
  it('rounds both ends of a single standalone cell', () => {
    expect(runEdgeClasses(false, false)).toBe('rounded-md')
  })

  it('rounds only the left edge at the start of a run', () => {
    expect(runEdgeClasses(false, true)).toBe('rounded-l-md')
  })

  it('rounds only the right edge at the end of a run', () => {
    expect(runEdgeClasses(true, false)).toBe('rounded-r-md')
  })

  it('leaves interior cells square so the run reads as one block', () => {
    expect(runEdgeClasses(true, true)).toBe('')
  })
})

describe('hatchRunStyle', () => {
  const base = { background: 'repeating-linear-gradient(45deg, #000, #000 3px)' }

  it('leaves the first cell of a run untouched', () => {
    expect(hatchRunStyle(base, 0, SLOT_COLUMN_WIDTH_PX)).toEqual(base)
  })

  it('shifts the gradient left by one column per cell into the run', () => {
    expect(hatchRunStyle(base, 1, 80).backgroundPosition).toBe('-80px 0')
    expect(hatchRunStyle(base, 3, 80).backgroundPosition).toBe('-240px 0')
  })

  it('keeps the original background while re-phasing it', () => {
    expect(hatchRunStyle(base, 2, 80).background).toBe(base.background)
  })
})
