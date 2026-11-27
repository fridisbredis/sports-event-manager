'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Chip } from '@heroui/react'
import { AppCard } from '@/components/ui/app-card'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import { useLanguage } from '@/components/i18n-provider'
import { useAdminEventPath } from '@/lib/hooks/use-admin-event-path'
import { WORK_AREA_COLORS, workAreaColorMap, workAreaDotColor } from '@/lib/theme/work-area-colors'
import { DoneToggle } from '../../tasks/_components/done-toggle'
import { formatTaskWhen, isOverdue } from '../../tasks/_utils'
import type { TaskListItem } from '../../tasks/_load-list'

interface Props {
  tenantId: string
  stageId: string
  stageName: string
  tasks: TaskListItem[]
  /**
   * The phone view of SCHED-01 is view-only: the done state shows as text
   * instead of a tick, and there is no "Add task".
   */
  readOnly?: boolean
}

/**
 * N72: the selected stage's tasks, in their own block below the grid. Tasks
 * are not shifts, so they never enter the grid itself; this is where an admin
 * planning the day sees what else is due on the stage. All the stage's tasks,
 * not only the selected day's — a deadline on day 1 still matters on day 2
 * while it is not done.
 */
export function StageTasksBlock({ tenantId, stageId, stageName, tasks, readOnly = false }: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const language = useLanguage()
  const eventPath = useAdminEventPath()

  const colors = useMemo(
    () => workAreaColorMap(tasks.map((task) => ({ id: task.id, color: task.color }))),
    [tasks]
  )

  return (
    <AppCard as="section" className="mt-8" bodyClassName="p-0">
      <div className="flex items-center justify-between gap-4 border-b border-edge px-6 py-4">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[17px] font-bold tracking-tight text-ink">
            {t('tasks.blockTitle', { stage: stageName })}
          </h2>
          <span className="text-[13px] text-ink-muted">
            {t('tasks.taskCount', { count: tasks.length })}
          </span>
        </div>
        <LinkButton size="sm" onPress={() => router.push(eventPath('tasks'))}>
          {t('tasks.manageTasks')}
        </LinkButton>
      </div>

      {tasks.length === 0 ? (
        <p className="px-6 py-5 text-[15px] text-ink-soft">{t('tasks.noTasksOnStage')}</p>
      ) : (
        <ul className="divide-y divide-edge-soft">
          {tasks.map((task) => {
            const overdue = isOverdue(task)
            return (
              <li key={task.id} className="flex items-center gap-4 px-6 py-3">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor: workAreaDotColor(colors.get(task.id) ?? WORK_AREA_COLORS[0]),
                  }}
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => router.push(eventPath(`tasks/${task.id}`))}
                    className={`text-left text-[15px] font-medium hover:underline ${
                      task.done ? 'text-ink-muted line-through' : 'text-ink'
                    }`}
                  >
                    {task.name}
                  </button>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-soft">
                    <span>{formatTaskWhen(task, language)}</span>
                    {overdue && (
                      <Chip
                        size="sm"
                        variant="flat"
                        className="bg-status-pending-bg font-medium text-status-pending-text"
                      >
                        {t('tasks.overdue')}
                      </Chip>
                    )}
                    {task.assigneeNames.length > 0 && (
                      <span className="truncate">{task.assigneeNames.join(', ')}</span>
                    )}
                    {task.checklistTotal > 0 && (
                      <span>
                        {t('tasks.checklistShort', {
                          done: task.checklistDone,
                          total: task.checklistTotal,
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {readOnly ? (
                  task.done && (
                    <span className="text-[13px] font-medium text-status-ok-text">
                      {t('tasks.colDone')}
                    </span>
                  )
                ) : (
                  <DoneToggle tenantId={tenantId} task={task} />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && (
        <div className="flex justify-end border-t border-edge px-6 py-3">
          <LinkButton onPress={() => router.push(eventPath(`tasks/new?stageId=${stageId}`))}>
            + {t('tasks.addTask')}
          </LinkButton>
        </div>
      )}
    </AppCard>
  )
}
