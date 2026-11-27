'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SelectItem,
} from '@heroui/react'
import { CalendarDateTime, type DateValue } from '@internationalized/date'
import { Button } from '@/components/ui/button'
import { LinkButton } from '@/components/ui/link-button'
import { DatePicker, Input, Select, Textarea } from '@/components/ui/form-fields'
import ConfirmDialog from '@/components/confirm-dialog'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { firstFreeWorkAreaColor } from '@/lib/theme/work-area-colors'
import { isoToWallClock } from '@/lib/tasks/time'
import { ColorPicker } from '../../workstations/_components/color-picker'
import { deleteTask, saveTask } from '../actions'
import type { AssignableOfficial, TaskListItem } from '../_load-list'

// N72: add and edit a task in a dialog over the list it was opened from —
// the Tasks page or the block below the scheduling grid. Deliberately not the
// work area form: a task is one checkbox with a deadline, so this is one
// short column of fields.

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

interface Props {
  tenantId: string
  eventId: string
  stageId: string
  stageName: string
  officials: AssignableOfficial[]
  /** The stage's tasks, for which colours are already taken. */
  stageTasks: TaskListItem[]
  /** Null adds a new task to the stage. */
  task: TaskListItem | null
  onClose: () => void
}

interface FormErrors {
  name?: string
  deadline?: string
  startsAt?: string
}

export function TaskDialog({
  tenantId,
  eventId,
  stageId,
  stageName,
  officials,
  stageTasks,
  task,
  onClose,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const isEdit = task !== null

  const takenBy = stageTasks
    .filter((other) => other.id !== task?.id && other.color)
    .map((other) => ({ color: other.color!, name: other.name }))

  const [color, setColor] = useState<string | null>(
    task ? task.color : firstFreeWorkAreaColor(takenBy.map((entry) => entry.color)).name
  )
  const [name, setName] = useState(task?.name ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [startsAt, setStartsAt] = useState<string | null>(isoToWallClock(task?.starts_at ?? null))
  const [deadline, setDeadline] = useState<string | null>(isoToWallClock(task?.deadline ?? null))
  const [assigneeIds, setAssigneeIds] = useState<string[]>(task?.assigneeIds ?? [])
  const [done, setDone] = useState(task?.done ?? false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isSaving, startSave] = useTransition()
  const [isDeleting, startDelete] = useTransition()
  const isBusy = isSaving || isDeleting

  function validate(): boolean {
    const next: FormErrors = {}
    if (!name.trim()) next.name = t('tasks.nameRequired')
    if (!deadline) next.deadline = t('tasks.deadlineRequired')
    else if (startsAt && startsAt > deadline) next.startsAt = t('tasks.startAfterDeadline')
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function handleSave() {
    if (!validate()) return
    startSave(async () => {
      const result = await saveTask({
        tenantId,
        eventId,
        taskId: task?.id ?? null,
        stageId: task?.stage_id ?? stageId,
        name,
        description,
        color,
        startsAt,
        deadline: deadline!,
        done,
        assigneeIds,
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  function confirmDelete() {
    if (!task) return
    setDeleteDialogOpen(false)
    startDelete(async () => {
      const result = await deleteTask({ tenantId, taskId: task.id })
      if (result.error) {
        toastError(result.error)
        return
      }
      router.refresh()
      onClose()
    })
  }

  return (
    <>
      <Modal
        isOpen
        onOpenChange={(open) => !open && !isBusy && onClose()}
        // A click outside or Escape (which also folds the colour palette)
        // must not throw away what was typed; Cancel and × still close.
        isDismissable={false}
        isKeyboardDismissDisabled
        size="lg"
        scrollBehavior="inside"
        classNames={{ base: 'bg-gray-50' }}
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-0.5">
            <span className="text-[17px] font-semibold text-ink">
              {isEdit ? t('tasks.editTitle') : t('tasks.addTitle')}
            </span>
            <span className="text-[13px] font-normal text-ink-muted">{stageName}</span>
          </ModalHeader>

          <ModalBody className="gap-5">
            <ColorPicker
              value={color}
              takenBy={takenBy}
              onChange={setColor}
              hint={t('tasks.colorHint')}
            />

            <Input
              label={t('tasks.titleLabel')}
              isRequired
              value={name}
              onValueChange={(value) => {
                setName(value)
                if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }))
              }}
              placeholder={t('tasks.namePlaceholder')}
              isInvalid={!!errors.name}
              errorMessage={errors.name}
            />

            <Textarea
              label={t('tasks.notesLabel')}
              value={description}
              onValueChange={setDescription}
              minRows={2}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <DatePicker
                  label={t('tasks.startLabel')}
                  granularity="minute"
                  hourCycle={24}
                  value={parseWallClock(startsAt)}
                  onChange={(value) => {
                    setStartsAt(toWallClock(value))
                    setErrors((prev) => ({ ...prev, startsAt: undefined }))
                  }}
                  isInvalid={!!errors.startsAt}
                  errorMessage={errors.startsAt}
                />
                {startsAt && (
                  <LinkButton size="sm" className="mt-1" onPress={() => setStartsAt(null)}>
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
                  setDeadline(toWallClock(value))
                  setErrors((prev) => ({ ...prev, deadline: undefined, startsAt: undefined }))
                }}
                isInvalid={!!errors.deadline}
                errorMessage={errors.deadline}
              />
            </div>

            {officials.length === 0 ? (
              <p className="text-[14px] text-ink-soft">{t('tasks.noOfficials')}</p>
            ) : (
              <Select
                label={t('tasks.assigneesLabel')}
                description={t('tasks.assigneesHint')}
                selectionMode="multiple"
                selectedKeys={assigneeIds}
                onSelectionChange={(keys) =>
                  setAssigneeIds(Array.from(keys).filter((k): k is string => typeof k === 'string'))
                }
              >
                {officials.map((official) => (
                  <SelectItem key={official.id}>{official.name}</SelectItem>
                ))}
              </Select>
            )}

            {/* Sized to the field labels above, not HeroUI's 16px default. */}
            <Checkbox
              size="sm"
              isSelected={done}
              onValueChange={setDone}
              classNames={{ label: 'text-[14px] text-ink' }}
            >
              {t('tasks.doneLabel')}
            </Checkbox>
          </ModalBody>

          <ModalFooter className="items-center">
            {isEdit && (
              <LinkButton
                tone="danger"
                className="mr-auto"
                onPress={() => setDeleteDialogOpen(true)}
                isDisabled={isBusy}
              >
                {t('tasks.delete')}
              </LinkButton>
            )}
            <Button variant="light" onPress={onClose} isDisabled={isBusy}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button color="primary" onPress={handleSave} isDisabled={isBusy} isLoading={isSaving}>
              {isSaving ? t('tasks.saving') : t('tasks.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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
    </>
  )
}
