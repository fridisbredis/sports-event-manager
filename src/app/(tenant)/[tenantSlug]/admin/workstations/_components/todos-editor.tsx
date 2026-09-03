import type { MutableRefObject } from 'react'
import { Input } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  todos: string[]
  todoRefs: MutableRefObject<(HTMLInputElement | null)[]>
  onAddTodo: () => void
  onRemoveTodo: (index: number) => void
  onUpdateTodo: (index: number, value: string) => void
}

export function TodosEditor({ todos, todoRefs, onAddTodo, onRemoveTodo, onUpdateTodo }: Props) {
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
              <input
                type="checkbox"
                disabled
                className="h-4 w-4 rounded border-gray-300 text-gray-400 cursor-not-allowed opacity-50"
              />
              <Input
                ref={(el) => {
                  todoRefs.current[i] = el
                }}
                type="text"
                value={todo}
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
              <Button
                variant="light"
                size="sm"
                onPress={() => onRemoveTodo(i)}
                className="text-xs text-default-400 min-w-0 px-1"
              >
                {t('workstations.removeTodo')}
              </Button>
            </div>
          ))}
        </div>
        <div className="px-3 py-2.5 border-t border-gray-100">
          <Button variant="light" size="sm" onPress={onAddTodo} className="text-default-500 px-0">
            {t('workstations.addTodo')}
          </Button>
        </div>
      </div>
    </section>
  )
}
