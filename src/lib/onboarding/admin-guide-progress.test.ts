import { describe, expect, it } from 'vitest'
import { getAdminGuideSteps } from './admin-guide-progress'

describe('getAdminGuideSteps', () => {
  it('marks the first incomplete step as next and scheduling as locked until prerequisites exist', () => {
    const result = getAdminGuideSteps({
      eventConfigComplete: true,
      workAreaCount: 0,
      confirmedOfficialCount: 1,
      assignedShiftCount: 0,
      isPublished: false,
    })

    expect(result.completedCount).toBe(1)
    expect(result.steps.map(({ status }) => status)).toEqual([
      'complete',
      'current',
      'upcoming',
      'locked',
      'upcoming',
    ])
  })

  it('unlocks scheduling only after a work area and confirmed official exist', () => {
    const result = getAdminGuideSteps({
      eventConfigComplete: true,
      workAreaCount: 1,
      confirmedOfficialCount: 2,
      assignedShiftCount: 0,
      isPublished: false,
    })

    expect(result.steps[3].status).toBe('current')
  })

  it('counts completed setup steps and marks publication complete', () => {
    const result = getAdminGuideSteps({
      eventConfigComplete: true,
      workAreaCount: 2,
      confirmedOfficialCount: 2,
      assignedShiftCount: 6,
      isPublished: true,
    })

    expect(result.completedCount).toBe(5)
    expect(result.steps.every(({ status }) => status === 'complete')).toBe(true)
  })
})
