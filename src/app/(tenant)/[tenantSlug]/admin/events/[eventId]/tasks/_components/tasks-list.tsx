'use client'

import { Flag } from 'lucide-react'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Accordion,
  AccordionItem,
  Checkbox,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from '@heroui/react'
import { Button } from '@/components/ui/button'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import { useLanguage } from '@/components/i18n-provider'
import { useAdminEventPath } from '@/lib/hooks/use-admin-event-path'
import { toastError } from '@/lib/toast'
import {
  WORK_AREA_COLORS,
  workAreaColorMap,
  workAreaDotColor,
  type WorkAreaColor,
} from '@/lib/theme/work-area-colors'
import { formatStageDate, type Stage } from '../../workstations/_utils'
import { formatTaskWhen, isOverdue } from '../_utils'
import { setTaskDone } from '../actions'

// N72. Laid out like the work areas list (one panel per stage, the same
// table look) so the two pages read as siblings. A separate component rather
// than a shared one for now: the shared stage-grouped shell is extracted in a
// later cleanup, once both pages exist and their common shape is proven.

const FALLBACK_COLOR: WorkAreaColor = WORK_AREA_COLORS[0]

export interface TaskListItem {
  id: string
  name: string
  color: string | null
  stage_id: string
  starts_at: string | null
  deadline: string
  done: boolean
  assigneeNames: string[]
  checklistDone: number
  checklistTotal: number
}

interface Props {
  tenantId: string
  stages: Stage[]
  tasks: TaskListItem[]
}

function StageTitle({ stage, count }: { stage: Stage; count: number }) {
  const { t } = useTranslation('admin')
  const language = useLanguage()
  const dateStr = formatStageDate(stage, language)

  return (
    <div className="flex w-full items-center gap-3">
      <span className="font-display text-[17px] font-bold tracking-tight text-ink">
        {stage.name}
      </span>
      <Chip
        size="sm"
        variant="flat"
        className={
          stage.stage_type === 'race'
            ? 'bg-tenant-accent-tint font-medium text-tenant-accent-tint-text'
            : 'bg-status-neutral-bg font-medium text-status-neutral-text'
        }
      >
        {stage.stage_type === 'race'
          ? t('eventConfig.stageTypeRace')
          : t('eventConfig.stageTypeNonRace')}
      </Chip>
      {/* Body text inside HeroUI's <h2> title: ask for the system stack back,
          as the work areas list does. */}
      {dateStr && <span className="font-sans text-[13px] text-ink-muted">{dateStr}</span>}
      <span className="ml-auto font-sans text-[13px] text-ink-muted">
        {t('tasks.taskCount', { count })}
      </span>
    </div>
  )
}

/**
 * The done tick in a row. Optimistic: it flips at once and goes back with a
 * toast if the save fails. Its clicks stop at the cell, so ticking a task
 * does not also open it.
 */
function DoneToggle({ tenantId, task }: { tenantId: string; task: TaskListItem }) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [done, setDone] = useState(task.done)
  const [isPending, startTransition] = useTransition()

  function toggle(next: boolean) {
    setDone(next)
    startTransition(async () => {
      const result = await setTaskDone({ tenantId, taskId: task.id, done: next })
      if (result.error) {
        setDone(!next)
        toastError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div onClick={(e) => e.stopPropagation()} className="inline-flex">
      <Checkbox
        isSelected={done}
        isDisabled={isPending}
        onValueChange={toggle}
        aria-label={t('tasks.markDone', { name: task.name })}
      />
    </div>
  )
}

function StageContent({
  tenantId,
  stage,
  tasks,
  colors,
}: {
  tenantId: string
  stage: Stage
  tasks: TaskListItem[]
  colors: Map<string, WorkAreaColor>
}) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const eventPath = useAdminEventPath()
  const language = useLanguage()

  return (
    <div>
      {tasks.length > 0 && (
        <Table
          removeWrapper
          aria-label={stage.name}
          classNames={{
            th: 'bg-status-neutral-bg text-[14px] font-medium text-ink-soft first:rounded-l-lg last:rounded-r-lg',
            td: 'py-4',
          }}
        >
          <TableHeader>
            <TableColumn>{t('tasks.nameLabel')}</TableColumn>
            <TableColumn>{t('tasks.colWhen')}</TableColumn>
            {/* Admin screens are web-first; on a phone the table keeps name,
                deadline and the tick, and the detail page has the rest. */}
            <TableColumn className="hidden md:table-cell">{t('tasks.colAssignees')}</TableColumn>
            <TableColumn className="hidden md:table-cell">{t('tasks.colChecklist')}</TableColumn>
            <TableColumn align="end">{t('tasks.colDone')}</TableColumn>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => {
              const overdue = isOverdue(task)
              return (
                <TableRow
                  key={task.id}
                  className="cursor-pointer"
                  onClick={() => router.push(eventPath(`tasks/${task.id}`))}
                >
                  <TableCell className="text-[15px] font-medium text-ink">
                    <span className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: workAreaDotColor(colors.get(task.id) ?? FALLBACK_COLOR),
                        }}
                      />
                      <span className={task.done ? 'text-ink-muted line-through' : undefined}>
                        {task.name}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-[15px] text-ink-soft">
                    <span className="flex flex-wrap items-center gap-2">
                      {formatTaskWhen(task, language)}
                      {overdue && (
                        <Chip
                          size="sm"
                          variant="flat"
                          className="bg-status-pending-bg font-medium text-status-pending-text"
                        >
                          {t('tasks.overdue')}
                        </Chip>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-[15px] text-ink-soft md:table-cell">
                    {task.assigneeNames.length > 0 ? task.assigneeNames.join(', ') : '—'}
                  </TableCell>
                  <TableCell className="hidden text-[15px] text-ink-soft md:table-cell">
                    {task.checklistTotal > 0
                      ? t('tasks.checklistProgress', {
                          done: task.checklistDone,
                          total: task.checklistTotal,
                        })
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <DoneToggle tenantId={tenantId} task={task} />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      <div className="mt-2 flex justify-end border-t border-edge pt-3">
        <LinkButton onPress={() => router.push(eventPath(`tasks/new?stageId=${stage.id}`))}>
          + {t('tasks.addTask')}
        </LinkButton>
      </div>
    </div>
  )
}

export default function TasksList({ tenantId, stages, tasks }: Props) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const eventPath = useAdminEventPath()

  const colors = useMemo(
    () => workAreaColorMap(tasks.map((task) => ({ id: task.id, color: task.color }))),
    [tasks]
  )

  if (stages.length === 0) {
    return (
      <div>
        <h1 className="page-title mb-6">{t('tasks.title')}</h1>
        <EmptyStateCard
          Icon={Flag}
          title={t('tasks.noStages')}
          description={t('tasks.noStagesHint')}
        >
          <Button variant="bordered" onPress={() => router.push(eventPath('event'))}>
            {t('workstations.goToEventConfig')}
          </Button>
        </EmptyStateCard>
      </div>
    )
  }

  return (
    <div>
      <h1 className="page-title mb-2">{t('tasks.title')}</h1>
      <p className="mb-6 text-[15px] text-ink-soft">{t('tasks.intro')}</p>
      <Accordion
        variant="splitted"
        defaultExpandedKeys={stages.map((s) => s.id)}
        itemClasses={{
          base: `${CARD_SURFACE} card-accent-primary px-6 py-1`,
          trigger: 'py-4',
          content: 'pb-4 pt-0',
        }}
        className="gap-4 px-0"
      >
        {stages.map((stage) => {
          const stageTasks = tasks.filter((task) => task.stage_id === stage.id)
          return (
            <AccordionItem
              key={stage.id}
              textValue={stage.name}
              title={<StageTitle stage={stage} count={stageTasks.length} />}
            >
              <StageContent tenantId={tenantId} stage={stage} tasks={stageTasks} colors={colors} />
            </AccordionItem>
          )
        })}
      </Accordion>
    </div>
  )
}
