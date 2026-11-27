'use client'

import type { CSSProperties } from 'react'
import { AppCard } from '@/components/ui/app-card'
import { useLanguage } from '@/components/i18n-provider'
import {
  WORK_AREA_COLORS,
  workAreaColorMap,
  type WorkAreaColor,
} from '@/lib/theme/work-area-colors'
import { formatTaskWhen, isOverdue } from '@/lib/tasks/time'
import {
  ChecklistItemRow,
  type ChecklistCheck,
  type ChecklistStrings,
  type ChecklistTodo,
} from './checklist-item-row'
import { toggleMyTaskDone, toggleMyTaskTodo } from '../actions'

/** One checklist item on a task, with its current tick (null = unticked). */
export type MyTaskTodo = ChecklistTodo & { check: ChecklistCheck | null }

export interface MyTask {
  id: string
  name: string
  description: string | null
  color: string | null
  stageName: string
  starts_at: string | null
  deadline: string
  /** The task's own done tick, in the same shape as a checklist item's. */
  doneCheck: ChecklistCheck | null
  /** The other officials on the task, by name. */
  coAssignees: string[]
  todos: MyTaskTodo[]
}

export interface MyTasksStrings {
  title: string
  overdue: string
  /** Carries `{{names}}`. */
  withYou: string
  markDone: string
  /** Carries `{{name}}` and `{{time}}`, like checklistStrings.checkedBy. */
  doneBy: string
  todoLabel: string
  infoLabel: string
}

interface Props {
  tasks: MyTask[]
  tenantSlug: string
  currentUserId: string | null
  strings: MyTasksStrings
  checklistStrings: ChecklistStrings
}

/**
 * N72: the official's tasks, in their own block below the shifts. Every task
 * of the event they are on, not only the selected day's — a task is due by a
 * deadline, not worked on a day, and an undone one from yesterday still
 * needs doing.
 *
 * The done tick and the checklist both render through ChecklistItemRow, so
 * they behave exactly like a shift's checklist: optimistic tick, "done by
 * Anna 14:02", and a confirm before clearing a colleague's tick.
 */
export function MyTasks({ tasks, tenantSlug, currentUserId, strings, checklistStrings }: Props) {
  const language = useLanguage()

  if (tasks.length === 0) return null

  const colors = workAreaColorMap(tasks.map((task) => ({ id: task.id, color: task.color })))

  return (
    <section aria-labelledby="my-tasks-heading" className="mt-8">
      <h2 id="my-tasks-heading" className="section-label mb-3">
        {strings.title}
      </h2>
      <div className="flex flex-col gap-3">
        {tasks.map((task) => {
          const color: WorkAreaColor = colors.get(task.id) ?? WORK_AREA_COLORS[0]
          const done = task.doneCheck !== null
          const overdue = isOverdue({ done, deadline: task.deadline })
          const checkable = task.todos.filter((todo) => todo.item_type === 'checkbox')
          const info = task.todos.filter((todo) => todo.item_type !== 'checkbox')

          return (
            <AppCard
              key={task.id}
              className="card-accent-left-themed"
              bodyClassName="px-4 py-3"
              style={{ '--card-accent': color.bg } as CSSProperties}
            >
              <p
                className={`text-sm font-semibold ${done ? 'text-gray-400 line-through' : 'text-gray-900'}`}
              >
                {task.name}
              </p>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                <span>
                  {task.stageName} · {formatTaskWhen(task, language)}
                </span>
                {overdue ? (
                  <span className="rounded-full bg-status-pending-bg px-2 py-0.5 text-xs font-medium text-status-pending-text">
                    {strings.overdue}
                  </span>
                ) : null}
              </div>
              {task.description ? (
                <p className="mt-1 text-xs text-gray-500">{task.description}</p>
              ) : null}
              {task.coAssignees.length > 0 ? (
                <p className="mt-1 text-xs text-gray-500">
                  {strings.withYou.replace('{{names}}', task.coAssignees.join(', '))}
                </p>
              ) : null}

              {task.todos.length > 0 ? (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  {checkable.length > 0 ? (
                    <>
                      <p className="section-label mb-2">{strings.todoLabel}</p>
                      <ul className="flex flex-col gap-2">
                        {checkable.map((todo) => (
                          <ChecklistItemRow
                            key={todo.id}
                            todo={todo}
                            check={todo.check}
                            color={color}
                            tenantSlug={tenantSlug}
                            onToggle={(checked) =>
                              toggleMyTaskTodo({ tenantSlug, id: todo.id, checked })
                            }
                            currentUserId={currentUserId}
                            strings={checklistStrings}
                          />
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {info.length > 0 ? (
                    <>
                      <p className={`section-label mb-2 ${checkable.length > 0 ? 'mt-4' : ''}`}>
                        {strings.infoLabel}
                      </p>
                      <ul className="flex flex-col gap-2">
                        {info.map((todo) => (
                          <ChecklistItemRow
                            key={todo.id}
                            todo={todo}
                            check={null}
                            color={color}
                            tenantSlug={tenantSlug}
                            currentUserId={currentUserId}
                            strings={checklistStrings}
                          />
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              ) : null}

              {/* The task's own tick, last: the checklist is the work, this
                  is the statement that the work is finished. */}
              <ul className="mt-3 border-t border-gray-100 pt-3">
                <ChecklistItemRow
                  todo={{
                    id: task.id,
                    instruction_text: strings.markDone,
                    position: 0,
                    item_type: 'checkbox',
                  }}
                  check={task.doneCheck}
                  color={color}
                  tenantSlug={tenantSlug}
                  onToggle={(checked) => toggleMyTaskDone({ tenantSlug, id: task.id, checked })}
                  strikeWhenChecked={false}
                  currentUserId={currentUserId}
                  strings={{ ...checklistStrings, checkedBy: strings.doneBy }}
                />
              </ul>
            </AppCard>
          )
        })}
      </div>
    </section>
  )
}
