'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { setEventArchived } from '@/lib/actions/set-event-archived'

// N23: shown on every screen of an archived event. The database refuses
// edits to it (the archive lock, P0004); this says so before the admin tries,
// and offers the way back. Restoring brings it back as a draft and is
// refused by the cap trigger when no slot is free, which the action explains.
export function ArchivedEventBanner({
  tenantSlug,
  eventId,
}: {
  tenantSlug: string
  eventId: string
}) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function restore() {
    startTransition(async () => {
      const result = await setEventArchived({ tenantSlug, eventId, archived: false })
      if (result.error) {
        toastError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="px-4 pt-6 md:px-8 md:pt-8">
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-card-sm border border-amber-200 bg-status-pending-bg px-5 py-4"
      >
        <Archive
          className="size-5 shrink-0 text-status-pending-text"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-status-pending-text">
            {t('events.archivedBanner.title')}
          </p>
          <p className="mt-0.5 text-sm text-status-pending-text/90">
            {t('events.archivedBanner.body')}
          </p>
        </div>
        <Button
          variant="bordered"
          className="rounded-control border-amber-300 bg-white"
          onPress={restore}
          isLoading={isPending}
        >
          {t('events.archivedBanner.restore')}
        </Button>
      </div>
    </div>
  )
}
