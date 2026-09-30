'use client'

import { useRef } from 'react'
import { Input } from '@heroui/react'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import type { ChecklistItemType } from '@/types/app'

/** One row in the editor. `text` is the instruction, `itemType` its kind. */
export interface TodoDraft {
  text: string
  itemType: ChecklistItemType
}

interface Props {
  todos: TodoDraft[]
  onChange: (next: TodoDraft[]) => void
}

interface ListProps {
  heading: string
  hint: string
  addLabel: string
  placeholder: string
  removeLabel: string
  rows: { draft: TodoDraft; index: number }[]
  /** Renders the leading glyph for this list — a checkbox outline or a dot. */
  marker: React.ReactNode
  onAdd: () => void
  onRemove: (index: number) => void
  onUpdate: (index: number, value: string) => void
  onBlurRow: (index: number) => void
  focusIndex: React.MutableRefObject<number | null>
}

/**
 * One of the two lists. Both are the same shape — heading, rows, add link —
 * and differ only in their marker and wording, so they share this component
 * rather than being written out twice.
 */
function TodoList({
  heading,
  hint,
  addLabel,
  placeholder,
  removeLabel,
  rows,
  marker,
  onAdd,
  onRemove,
  onUpdate,
  onBlurRow,
  focusIndex,
}: ListProps) {
  return (
    <div>
      <div className="mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{heading}</h3>
        <p className="mt-1 text-xs text-gray-400">{hint}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        {rows.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {rows.map(({ draft, index }) => (
              <div key={index} className="flex items-center gap-3 px-3 py-2.5">
                {marker}
                <Input
                  ref={(el) => {
                    // Focus the row this list just added, without a ref array
                    // that would have to stay aligned with a filtered view of
                    // a shared list.
                    if (el && focusIndex.current === index) {
                      focusIndex.current = null
                      setTimeout(() => el.focus(), 0)
                    }
                  }}
                  type="text"
                  value={draft.text}
                  onChange={(e) => onUpdate(index, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      onAdd()
                    }
                  }}
                  // Enter adds a row and moves focus to it; leaving that row
                  // without typing anything should not leave a blank behind.
                  // Only ever drops a row that is empty, so a row with text
                  // survives losing focus however it was left.
                  onBlur={() => onBlurRow(index)}
                  placeholder={placeholder}
                  classNames={{
                    base: 'flex-1',
                    inputWrapper:
                      '!bg-transparent data-[hover=true]:!bg-transparent group-data-[focus=true]:!bg-transparent shadow-none px-2 py-0',
                    input: 'text-sm text-gray-900 placeholder:text-gray-400',
                  }}
                />
                <LinkButton size="sm" tone="danger" onPress={() => onRemove(index)}>
                  {removeLabel}
                </LinkButton>
              </div>
            ))}
          </div>
        ) : null}
        <div className={`px-4 py-3 ${rows.length > 0 ? 'border-t border-edge' : ''}`}>
          <LinkButton onPress={onAdd}>{addLabel}</LinkButton>
        </div>
      </div>
    </div>
  )
}

/**
 * The two checklist lists an admin edits: things officials tick off during
 * their shift, and notes they only read.
 *
 * They are two views over one `todos` array rather than two arrays, because
 * that array is what both RPCs take and what `position` is derived from. Each
 * row carries its index into that array, so editing one list never disturbs
 * the other's ordering.
 */
export function TodosEditor({ todos, onChange }: Props) {
  const { t } = useTranslation('admin')
  // Which absolute index to focus once it renders. A ref, not state: it must
  // survive the re-render the add causes without triggering another.
  const focusIndex = useRef<number | null>(null)
  // Mirrors `todos` for the deferred blur handler below, which runs after the
  // render that follows blur and must not act on a stale array.
  const latestTodos = useRef(todos)
  latestTodos.current = todos

  const rowsOfType = (itemType: ChecklistItemType) =>
    todos
      .map((draft, index) => ({ draft, index }))
      .filter(({ draft }) => draft.itemType === itemType)

  function add(itemType: ChecklistItemType) {
    // Appended at the end of the whole array: `position` follows array order,
    // and the official-facing screen groups by kind anyway, so the two lists
    // stay independently ordered without interleaving logic here.
    focusIndex.current = todos.length
    onChange([...todos, { text: '', itemType }])
  }

  function remove(index: number) {
    onChange(todos.filter((_, i) => i !== index))
  }

  function update(index: number, value: string) {
    onChange(todos.map((todo, i) => (i === index ? { ...todo, text: value } : todo)))
  }

  /**
   * Drops a row left empty when focus leaves it — the blank Enter adds and
   * nobody fills in.
   *
   * Deferred a tick rather than run inline: blur fires BEFORE the click that
   * caused it, so removing here and now would reindex the list out from under
   * a pending click and delete the wrong row (or fire "Remove" on a row that
   * has shifted up). Waiting lets the click land first, and the empty row is
   * still gone before anyone can type into it.
   *
   * Whitespace counts as empty, matching what the save path already does —
   * `normaliseTodos` trims and drops blanks, so a row of spaces was never
   * going to be saved anyway.
   */
  function blurRow(index: number) {
    setTimeout(() => {
      // Read through the ref, not the closure: by the time this runs the
      // click it deferred to may already have edited or removed rows, and
      // acting on the array as it looked at blur time would undo that.
      const current = latestTodos.current
      const row = current[index]
      if (!row || row.text.trim() !== '') return
      onChange(current.filter((_, i) => i !== index))
    }, 0)
  }

  return (
    <section>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {t('workstations.todosLabel')}
      </h2>
      <div className="flex flex-col gap-5">
        <TodoList
          heading={t('workstations.checklistHeading')}
          hint={t('workstations.checklistHint')}
          addLabel={t('workstations.addChecklistItem')}
          placeholder={t('workstations.checklistPlaceholder')}
          removeLabel={t('workstations.removeTodo')}
          rows={rowsOfType('checkbox')}
          // An outline, not an interactive control: it previews the checkbox
          // an official will see. Making it clickable here would suggest an
          // admin can tick the work off on their behalf.
          marker={
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded border-2 border-gray-300"
            />
          }
          onAdd={() => add('checkbox')}
          onRemove={remove}
          onUpdate={update}
          onBlurRow={blurRow}
          focusIndex={focusIndex}
        />
        <TodoList
          heading={t('workstations.notesHeading')}
          hint={t('workstations.notesHint')}
          addLabel={t('workstations.addNote')}
          placeholder={t('workstations.notePlaceholder')}
          removeLabel={t('workstations.removeTodo')}
          rows={rowsOfType('info')}
          marker={<span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gray-300" />}
          onAdd={() => add('info')}
          onRemove={remove}
          onUpdate={update}
          onBlurRow={blurRow}
          focusIndex={focusIndex}
        />
      </div>
    </section>
  )
}
