'use client'

import { useEffect, useRef } from 'react'
import { Input } from '@heroui/react'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import type { ChecklistItemType } from '@/types/app'
import { AppCard } from '@/components/ui/app-card'

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
  /** Small grey label above the heading. Only the first list carries one. */
  groupLabel?: string
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
  groupLabel,
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
    <AppCard as="section">
      {/* The group label sits above the first list only, naming the pair the
          way the other column headings name their panels. `section-label`
          matches Capacity beside it, so each list reads as a peer panel in
          this column rather than a sub-heading of a combined one. */}
      {groupLabel ? <h2 className="section-label mb-2">{groupLabel}</h2> : null}
      <h3 className="mb-0.5 text-[15px] font-semibold text-ink">{heading}</h3>
      <p className="mb-3 text-[13px] text-gray-400">{hint}</p>
      {rows.length > 0 ? (
        <div className="mb-3 overflow-hidden rounded-lg border border-edge bg-white">
          <div className="divide-y divide-edge-soft">
            {rows.map(({ draft, index }) => (
              <div key={index} className="flex items-center gap-3 px-3 py-2">
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
                    // HeroUI gives the wrapper its own min-height, which is
                    // what made these rows taller than the design's. Cleared
                    // here so the row's own padding sets the height.
                    inputWrapper:
                      '!bg-transparent data-[hover=true]:!bg-transparent group-data-[focus=true]:!bg-transparent shadow-none px-2 py-0 h-auto !min-h-0',
                    // `truncate` so a long instruction ends in an ellipsis
                    // rather than being cut mid-glyph at the field edge. The
                    // full text is still there to scroll through once focused.
                    input: 'text-sm text-gray-900 placeholder:text-gray-400 truncate',
                  }}
                />
                <LinkButton size="sm" tone="danger" onPress={() => onRemove(index)}>
                  {removeLabel}
                </LinkButton>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <LinkButton onPress={onAdd}>{addLabel}</LinkButton>
    </AppCard>
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
  // render that follows blur and must not act on a stale array. Written in an
  // effect rather than during render — a ref write during render is what the
  // "Cannot access refs during render" rule forbids, and the effect still
  // lands well before the deferred handler reads it.
  const latestTodos = useRef(todos)
  useEffect(() => {
    latestTodos.current = todos
  }, [todos])

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

  // A fragment, not a wrapping element: the two lists are siblings of the
  // other panels in this column (Capacity and so on), so the column's own
  // spacing and card treatment apply to each of them separately. Nesting them
  // inside one wrapper made both share a single card.
  return (
    <>
      <TodoList
        groupLabel={t('workstations.todosLabel')}
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
          <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded border-2 border-gray-300" />
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
    </>
  )
}
