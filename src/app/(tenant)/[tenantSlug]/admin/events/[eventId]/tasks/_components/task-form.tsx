'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Checkbox, SelectItem } from '@heroui/react'
import { CalendarDateTime, type DateValue } from '@internationalized/date'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/ui/link-button'
import { AppCard } from '@/components/ui/app-card'
import { DatePicker, Input, Select, Textarea } from '@/components/ui/form-fields'
import ConfirmDialog from '@/components/confirm-dialog'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { saveInTransition, useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import { useAdminEventPath } from '@/lib/hooks/use-admin-event-path'
import { TodosEditor, type TodoDraft } from '../../workstations/_components/todos-editor'
import { ColorPicker, type ColorTakenBy } from '../../workstations/_components/color-picker'
import type { Stage } from '../../workstations/_utils'
import { deleteTask, saveTask, setTaskDone } from '../actions'

// N72: one form for creating and editing a task. Built from the same parts as
// the work area form — form-fields, AppCard, ColorPicker, TodosEditor — so the
// two read as siblings; the two-column layout is the same too.

// 'YYYY-MM-DDTHH:mm' wall clock ⇄ CalendarDateTime, as in the stage editor:
// zone-less, so the picker never shifts a time by the browser's offset.
function parseWallClock(raw: string | null): CalendarDateTime | null {
  if (!raw) return null
  const [datePart, timePart] = raw.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [h, min] = (timePart ?? '00:00').split(':').map(Number)
  if (!y || !m || !d) return null
  return new CalendarDateTime(y, m, d, h || 0, min || 0)
}

function toWallClock(value: DateValue | null): string | null {
  if (!value) return null
  const cdt = value as CalendarDateTime
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(cdt.year, 4)}-${pad(cdt.month)}-${pad(cdt.day)}T${pad(cdt.hour ?? 0)}:${pad(cdt.minute ?? 0)}`
}

export interface AssignableOfficial {
  id: string
  name: string
}

export interface TaskFormInitial {
  id: string
  stageId: string
  name: string
  description: string
  color: string | null
  /** 'YYYY-MM-DDTHH:mm' wall clock. */
  startsAt: string | null
  deadline: string
  done: boolean
  assigneeIds: string[]
  todos: TodoDraft[]
}

interface Props {
  tenantId: string
  eventId: string
  stages: Stage[]
  officials: AssignableOfficial[]
  /** Colours other tasks already use, per stage (this task left out). */
  takenByStage: Record<string, ColorTakenBy[]>
  /** Null on the create page. */
  initial: TaskFormInitial | null
  /** Create page: the stage whose "+ Add task" was clicked. */
  preselectedStageId: string | null
  defaultColor: string
}

interface FormErrors {
  name?: string
  deadline?: string
  startsAt?: string
}

export default function TaskForm({
  tenantId,
  eventId,
  stages,
  officials,
  takenByStage,
  initial,
  preselectedStageId,
  defaultColor,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const eventPath = useAdminEventPath()
  const isEdit = initial !== null

  const [stageId, setStageId] = useState(
    initial?.stageId ?? preselectedStageId ?? stages[0]?.id ?? ''
  )
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [color, setColor] = useState<string | null>(initial?.color ?? defaultColor)
  const [startsAt, setStartsAt] = useState<string | null>(initial?.startsAt ?? null)
  const [deadline, setDeadline] = useState<string | null>(initial?.deadline ?? null)
  const [done, setDone] = useState(initial?.done ?? false)
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial?.assigneeIds ?? [])
  const [todos, setTodos] = useState<TodoDraft[]>(initial?.todos ?? [])
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isDeleting, startDelete] = useTransition()
  const [isTogglingDone, startToggleDone] = useTransition()

  const { markDirty, markClean, guardedNavigate, dialogProps } = useUnsavedChanges({
    onSave: () => {
      if (!validate()) return Promise.resolve(false)
      return saveInTransition(startSave, save)
    },
  })

  // Every edit goes through here, so the unsaved-changes guard sees it.
  function edit<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      setSaveSuccess(false)
      markDirty()
    }
  }

  function validate(): boolean {
    const next: FormErrors = {}
    if (!name.trim()) next.name = t('tasks.nameRequired')
    if (!deadline) next.deadline = t('tasks.deadlineRequired')
    else if (startsAt && startsAt > deadline) next.startsAt = t('tasks.startAfterDeadline')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function save(): Promise<boolean> {
    const result = await saveTask({
      tenantId,
      eventId,
      taskId: initial?.id ?? null,
      stageId,
      name,
      description,
      color,
      startsAt,
      deadline: deadline!,
      todos: todos.map((todo) => ({
        id: todo.id,
        instruction_text: todo.text,
        item_type: todo.itemType,
      })),
      assigneeIds,
    })

    if (result.error) {
      toastError(result.error)
      return false
    }
    markClean()
    setSaveSuccess(true)
    return true
  }

  function handleSave() {
    if (!validate()) return
    startSave(async () => {
      // router.push, not guardedNavigate: save() has just marked the form
      // clean, but that state has not re-rendered into the guard yet.
      if (await save()) router.push(eventPath('tasks'))
    })
  }

  // Done is its own write (set_task_done, with its audit row), not part of
  // the form's save: ticking it here takes effect at once, like in the list.
  function toggleDone(next: boolean) {
    if (!initial) return
    setDone(next)
    startToggleDone(async () => {
      const result = await setTaskDone({ tenantId, taskId: initial.id, done: next })
      if (result.error) {
        setDone(!next)
        toastError(result.error)
      }
    })
  }

  function confirmDelete() {
    if (!initial) return
    setDeleteDialogOpen(false)
    startDelete(async () => {
      const result = await deleteTask({ tenantId, taskId: initial.id })
      if (result.error) {
        toastError(result.error)
      } else {
        markClean()
        router.push(eventPath('tasks'))
      }
    })
  }

  const isBusy = isSaving || isDeleting

  return (
    <div>
      <UnsavedChangesDialog {...dialogProps} />
      {isEdit && (
        <ConfirmDialog
          open={deleteDialogOpen}
          title={t('tasks.delete')}
          body={t('tasks.deleteConfirm')}
          cancelLabel={t('actions.cancel', { ns: 'common' })}
          confirmLabel={t('actions.delete', { ns: 'common' })}
          onCancel={() => setDeleteDialogOpen(false)}
          onConfirm={confirmDelete}
          destructive
        />
      )}

      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <LinkButton
            size="sm"
            onPress={() => guardedNavigate(eventPath('tasks'))}
            className="mb-1 no-underline hover:no-underline"
            startContent={<span aria-hidden="true">←</span>}
          >
            {t('tasks.backToList')}
          </LinkButton>
          <h1 className="page-title">
            {isEdit ? name || t('tasks.namePlaceholder') : t('tasks.addTitle')}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {isEdit && (
            <LinkButton tone="danger" onPress={() => setDeleteDialogOpen(true)} isDisabled={isBusy}>
              {t('tasks.delete')}
            </LinkButton>
          )}
          <Button
            color={saveSuccess ? 'success' : 'primary'}
            variant={saveSuccess ? 'flat' : 'solid'}
            onPress={handleSave}
            isDisabled={isBusy}
            isLoading={isSaving}
          >
            {isSaving ? t('tasks.saving') : saveSuccess ? t('tasks.saved') : t('tasks.save')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[3fr_2fr]">
        {/* Left column */}
        <AppCard bodyClassName="divide-y divide-edge p-0 [&>*]:px-6 [&>*]:py-5">
          <section>
            <h2 className="section-label mb-4">{t('tasks.stageLabel')}</h2>
            <Select
              label={t('tasks.stageLabel')}
              selectedKeys={stageId ? [stageId] : []}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0]
                if (typeof next === 'string') edit(setStageId)(next)
              }}
            >
              {stages.map((stage) => (
                <SelectItem key={stage.id}>{stage.name}</SelectItem>
              ))}
            </Select>
          </section>

          <section>
            <h2 className="section-label mb-4">{t('tasks.identity')}</h2>
            <div className="space-y-4">
              <Input
                label={t('tasks.nameLabel')}
                value={name}
                onValueChange={(value) => {
                  edit(setName)(value)
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
                }}
                placeholder={t('tasks.namePlaceholder')}
                isInvalid={!!errors.name}
                errorMessage={errors.name}
              />
              <Textarea
                label={t('tasks.descriptionLabel')}
                value={description}
                onValueChange={edit(setDescription)}
                minRows={3}
              />
            </div>
          </section>

          <ColorPicker
            value={color}
            takenBy={takenByStage[stageId] ?? []}
            onChange={edit(setColor)}
            hint={t('tasks.colorHint')}
          />

          <section>
            <h2 className="section-label mb-1">{t('tasks.timeLabel')}</h2>
            <p className="mb-4 text-[13px] text-gray-400">{t('tasks.timeHint')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <DatePicker
                  label={t('tasks.startLabel')}
                  granularity="minute"
                  hourCycle={24}
                  value={parseWallClock(startsAt)}
                  onChange={(value) => {
                    edit(setStartsAt)(toWallClock(value))
                    setErrors((prev) => ({ ...prev, startsAt: undefined }))
                  }}
                  isInvalid={!!errors.startsAt}
                  errorMessage={errors.startsAt}
                />
                {startsAt && (
                  <LinkButton size="sm" className="mt-1" onPress={() => edit(setStartsAt)(null)}>
                    {t('tasks.clearStart')}
                  </LinkButton>
                )}
              </div>
              <DatePicker
                label={t('tasks.deadlineLabel')}
                granularity="minute"
                hourCycle={24}
                isRequired
                value={parseWallClock(deadline)}
                onChange={(value) => {
                  edit(setDeadline)(toWallClock(value))
                  setErrors((prev) => ({ ...prev, deadline: undefined, startsAt: undefined }))
                }}
                isInvalid={!!errors.deadline}
                errorMessage={errors.deadline}
              />
            </div>
          </section>

          <section>
            <h2 className="section-label mb-1">{t('tasks.assigneesLabel')}</h2>
            <p className="mb-4 text-[13px] text-gray-400">{t('tasks.assigneesHint')}</p>
            {officials.length === 0 ? (
              <p className="text-[15px] text-ink-soft">{t('tasks.noOfficials')}</p>
            ) : (
              <Select
                label={t('tasks.assigneesLabel')}
                selectionMode="multiple"
                selectedKeys={assigneeIds}
                onSelectionChange={(keys) =>
                  edit(setAssigneeIds)(
                    Array.from(keys).filter((k): k is string => typeof k === 'string')
                  )
                }
              >
                {officials.map((official) => (
                  <SelectItem key={official.id}>{official.name}</SelectItem>
                ))}
              </Select>
            )}
          </section>
        </AppCard>

        {/* Right column */}
        <div className="space-y-4">
          {isEdit && (
            <AppCard as="section">
              <h2 className="section-label mb-4">{t('tasks.colDone')}</h2>
              <Checkbox isSelected={done} isDisabled={isTogglingDone} onValueChange={toggleDone}>
                {t('tasks.doneLabel')}
              </Checkbox>
            </AppCard>
          )}
          <TodosEditor
            todos={todos}
            onChange={edit(setTodos)}
            checklistHint={t('tasks.checklistHint')}
          />
        </div>
      </div>
    </div>
  )
}
