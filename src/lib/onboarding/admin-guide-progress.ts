export type AdminGuideStepId =
  | 'eventConfig'
  | 'workAreas'
  | 'officials'
  | 'scheduling'
  | 'publishing'

export type AdminGuideStepStatus = 'complete' | 'current' | 'upcoming' | 'locked'

export interface AdminGuideProgressInput {
  eventConfigComplete: boolean
  workAreaCount: number
  confirmedOfficialCount: number
  assignedShiftCount: number
  isPublished: boolean
}

export interface AdminGuideStep {
  id: AdminGuideStepId
  status: AdminGuideStepStatus
}

export function getAdminGuideSteps(input: AdminGuideProgressInput): {
  steps: AdminGuideStep[]
  completedCount: number
} {
  const ids: AdminGuideStepId[] = [
    'eventConfig',
    'workAreas',
    'officials',
    'scheduling',
    'publishing',
  ]
  const completed = [
    input.eventConfigComplete,
    input.workAreaCount > 0,
    // The tenant admin is already in the roster as a confirmed schedulable member.
    input.confirmedOfficialCount > 1,
    input.assignedShiftCount > 0,
    input.isPublished,
  ]
  const locked = [
    false,
    false,
    false,
    input.workAreaCount === 0 || input.confirmedOfficialCount === 0,
    false,
  ]
  const currentIndex = completed.findIndex((isComplete, index) => !isComplete && !locked[index])

  const steps = ids.map(
    (id, index): AdminGuideStep => ({
      id,
      status: completed[index]
        ? 'complete'
        : locked[index]
          ? 'locked'
          : index === currentIndex
            ? 'current'
            : 'upcoming',
    })
  )

  return {
    steps,
    completedCount: completed.filter(Boolean).length,
  }
}
