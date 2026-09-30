'use client'

import { useState, useTransition } from 'react'
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  useDisclosure,
} from '@heroui/react'
import { workAreaDotColor, type WorkAreaColor } from '@/lib/theme/work-area-colors'
import { toggleChecklistItem } from '../actions'

export type ChecklistCheck = {
  checked_by: string | null
  checked_at: string
  actorName: string | null
}

export type ChecklistTodo = {
  id: string
  instruction_text: string
  position: number
  item_type: string
}

export interface ChecklistStrings {
  /** Tooltip/label on the checkbox itself. */
  toggleLabel: string
  /** e.g. "Checked by {{name}} at {{time}}" */
  checkedBy: (name: string, time: string) => string
  /** Fallback when the actor's name is unknown (deleted account). */
  someone: string
  confirmTitle: string
  /** e.g. "{{name}} checked this off. Uncheck it anyway?" */
  confirmBody: (name: string) => string
  confirmCancel: string
  confirmConfirm: string
  saveFailed: string
}

interface Props {
  todo: ChecklistTodo
  check: ChecklistCheck | null
  color: WorkAreaColor
  tenantSlug: string
  workstationId: string
  timeslotStart: string
  timeslotEnd: string
  /** The viewer, to tell "you checked this" from "a colleague did". */
  currentUserId: string | null
  strings: ChecklistStrings
}

function formatCheckedAt(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

/**
 * One checklist row. An 'info' item renders exactly as before (a decorative
 * bullet plus text); a 'checkbox' item renders a real checkbox that writes
 * through to the shared per-shift state.
 *
 * Unchecking someone else's tick asks for confirmation first — the item is
 * shared by the whole shift, so clearing it discards a colleague's statement
 * that the work was done. Unchecking your own does not: it is your own
 * statement to withdraw, and a confirm on every mis-tap would be noise.
 * Both directions are recorded in checklist_item_events either way.
 */
export function ChecklistItemRow({
  todo,
  check,
  color,
  tenantSlug,
  workstationId,
  timeslotStart,
  timeslotEnd,
  currentUserId,
  strings,
}: Props) {
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Informational items keep the original bullet treatment untouched.
  if (todo.item_type !== 'checkbox') {
    return (
      <li className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-[5px] h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: workAreaDotColor(color) }}
        />
        <span className="text-sm text-gray-700">{todo.instruction_text}</span>
      </li>
    )
  }

  const isChecked = check !== null
  const isOwnCheck = check?.checked_by !== null && check?.checked_by === currentUserId
  const actorName = check?.actorName ?? strings.someone

  function submit(nextChecked: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await toggleChecklistItem({
        tenantSlug,
        todoId: todo.id,
        workstationId,
        timeslotStart,
        timeslotEnd,
        checked: nextChecked,
      })
      // The optimistic-free path: the row re-renders from the server's own
      // state after revalidatePath, so a rejected write (RLS, a lost race)
      // can never leave the box looking ticked when the database disagrees.
      if (result.error) setError(strings.saveFailed)
    })
  }

  function handleChange(nextChecked: boolean) {
    // Unchecking a colleague's tick is the only destructive direction — ask
    // first. "No" must do nothing at all, so the box is never updated here;
    // it only ever follows the server.
    if (!nextChecked && isChecked && !isOwnCheck) {
      onOpen()
      return
    }
    submit(nextChecked)
  }

  return (
    <li className="flex items-start gap-2.5">
      <input
        type="checkbox"
        checked={isChecked}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.checked)}
        aria-label={`${strings.toggleLabel}: ${todo.instruction_text}`}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary disabled:cursor-wait disabled:opacity-50"
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm ${isChecked ? 'text-gray-400 line-through' : 'text-gray-700'}`}
        >
          {todo.instruction_text}
        </span>
        {/* The "who and when" the shift can see. Rendered from the current
            state row rather than the event log: the log is the audit trail,
            this line is just the latest fact. */}
        {check ? (
          <span className="mt-0.5 block text-xs text-gray-400">
            {strings.checkedBy(actorName, formatCheckedAt(check.checked_at))}
          </span>
        ) : null}
        {error ? (
          <span role="alert" className="mt-0.5 block text-xs text-danger">
            {error}
          </span>
        ) : null}
      </span>

      <Modal isOpen={isOpen} onClose={onClose} size="sm" placement="center">
        <ModalContent>
          <ModalHeader className="text-base">{strings.confirmTitle}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-gray-600">{strings.confirmBody(actorName)}</p>
          </ModalBody>
          <ModalFooter>
            {/* "No" closes and changes nothing — no write, no audit row. */}
            <Button variant="light" onPress={onClose}>
              {strings.confirmCancel}
            </Button>
            <Button
              color="danger"
              onPress={() => {
                onClose()
                submit(false)
              }}
            >
              {strings.confirmConfirm}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </li>
  )
}
