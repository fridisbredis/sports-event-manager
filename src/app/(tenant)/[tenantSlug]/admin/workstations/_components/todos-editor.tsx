import type { MutableRefObject } from 'react'
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
  todoRefs: MutableRefObject<(HTMLInputElement | null)[]>
  onAddTodo: () => void
  onRemoveTodo: (index: number) => void
  onUpdateTodo: (index: number, value: string) => void
  onUpdateTodoType: (index: number, itemType: ChecklistItemType) => void
}

export function TodosEditor({
  todos,
  todoRefs,
  onAddTodo,
  onRemoveTodo,
  onUpdateTodo,
  onUpdateTodoType,
}: Props) {
  const { t } = useTranslation('admin')

  return (
    <section>
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">
        {t('workstations.todosLabel')}
      </h2>
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className="divide-y divide-gray-100">
          {todos.map((todo, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              {/*
                The checkbox is the type toggle, not a completion control —
                ticking it here marks the item as one an official will be able
                to tick on their shift. It was previously rendered permanently
                disabled, purely as a visual hint that v1 tracked no completion.
              */}
              <input
                type="checkbox"
                checked={todo.itemType === 'checkbox'}
                onChange={(e) => onUpdateTodoType(i, e.target.checked ? 'checkbox' : 'info')}
                aria-label={t('workstations.todoIsCheckbox')}
                title={t('workstations.todoIsCheckbox')}
                className="h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-primary focus:ring-primary"
              />
              <Input
                ref={(el) => {
                  todoRefs.current[i] = el
                }}
                type="text"
                value={todo.text}
                onChange={(e) => onUpdateTodo(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    onAddTodo()
                  }
                }}
                placeholder={t('workstations.todoPlaceholder')}
                classNames={{
                  base: 'flex-1',
                  inputWrapper:
                    '!bg-transparent data-[hover=true]:!bg-transparent group-data-[focus=true]:!bg-transparent shadow-none px-2 py-0',
                  input: 'text-sm text-gray-900 placeholder:text-gray-400',
                }}
              />
              <LinkButton size="sm" tone="danger" onPress={() => onRemoveTodo(i)}>
                {t('workstations.removeTodo')}
              </LinkButton>
            </div>
          ))}
        </div>
        <div className="border-t border-edge px-4 py-3 flex items-center justify-between gap-4">
          <LinkButton onPress={onAddTodo}>{t('workstations.addTodo')}</LinkButton>
          <p className="text-xs text-gray-400">{t('workstations.todoTypeHint')}</p>
        </div>
      </div>
    </section>
  )
}
