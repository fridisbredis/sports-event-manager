'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Checkbox } from '@heroui/react'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { setTaskDone } from '../actions'

/**
 * A task's done tick, for the Tasks list and the block below the scheduling
 * grid. Optimistic: it flips at once and goes back with a toast if the save
 * fails. Its clicks stop here, so ticking a row does not also open it.
 */
export function DoneToggle({
  tenantId,
  task,
}: {
  tenantId: string
  task: { id: string; name: string; done: boolean }
}) {
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
