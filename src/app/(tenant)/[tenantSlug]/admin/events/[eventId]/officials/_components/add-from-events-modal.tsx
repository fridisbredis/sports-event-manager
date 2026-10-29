'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { Checkbox, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-fields'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { formatPhoneForDisplay } from '@/lib/phone'
import { addOfficialsToEvent } from '../actions'

export interface OfficialCandidate {
  id: string
  name: string
  phone: string
  invite_status: string
  /** Names of the tenant's other events this person is in. */
  events: string[]
}

// Past this many, a search field earns its place.
const SEARCH_FROM = 8

// N23 (7c): pick officials the tenant already has, from its other events,
// and add them to this one. One officials row per person per tenant, so the
// invite form refuses their number; this is the way to bring them in.
export function AddFromEventsModal({
  open,
  onClose,
  tenantSlug,
  eventId,
  candidates,
}: {
  open: boolean
  onClose: () => void
  tenantSlug: string
  eventId: string
  candidates: OfficialCandidate[]
}) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q.replace(/\D/g, '') || q) ||
        c.events.some((e) => e.toLowerCase().includes(q))
    )
  }, [candidates, query])

  function close() {
    if (isPending) return
    setSelected(new Set())
    setQuery('')
    onClose()
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Acts on what the search shows: with a query, "all" means the matches.
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id))

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const c of visible) {
        if (allVisibleSelected) next.delete(c.id)
        else next.add(c.id)
      }
      return next
    })
  }

  function submit() {
    if (selected.size === 0) return
    startTransition(async () => {
      const result = await addOfficialsToEvent({
        tenantSlug,
        eventId,
        officialIds: [...selected],
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      setSelected(new Set())
      setQuery('')
      onClose()
      router.refresh()
    })
  }

  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && close()}
      size="lg"
      scrollBehavior="inside"
      classNames={{
        base: 'bg-white rounded-card shadow-modal',
        backdrop: 'bg-ink/45',
        header: 'px-6 pb-1 pt-6 font-display text-xl font-extrabold tracking-tight text-ink',
        body: 'px-6',
        footer: 'gap-3 px-6 pb-6 pt-4',
        closeButton: 'right-4 top-4 text-ink-label hover:bg-status-neutral-bg',
      }}
    >
      <ModalContent>
        <ModalHeader>{t('officials.fromEvents.title')}</ModalHeader>
        <ModalBody className="gap-4">
          <p className="text-sm text-ink-label">{t('officials.fromEvents.hint')}</p>

          {candidates.length > SEARCH_FROM && (
            <Input
              aria-label={t('officials.fromEvents.search')}
              placeholder={t('officials.fromEvents.search')}
              value={query}
              onValueChange={setQuery}
              startContent={<Search className="size-4 text-ink-faint" aria-hidden />}
            />
          )}

          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-label">
              {t('officials.fromEvents.noMatches')}
            </p>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-sm text-ink-label">
                  {t('officials.fromEvents.selectedOf', {
                    n: selected.size,
                    total: candidates.length,
                  })}
                </span>
                <LinkButton onPress={toggleAllVisible}>
                  {allVisibleSelected
                    ? t('officials.fromEvents.deselectAll')
                    : query.trim()
                      ? t('officials.fromEvents.selectMatches')
                      : t('officials.fromEvents.selectAll')}
                </LinkButton>
              </div>
              <ul className="divide-y divide-edge-soft rounded-card-sm border border-edge">
                {visible.map((c) => (
                  <li key={c.id}>
                    <Checkbox
                      isSelected={selected.has(c.id)}
                      onValueChange={(on) => toggle(c.id, on)}
                      classNames={{
                        base: 'm-0 flex w-full max-w-full items-start gap-1 px-4 py-3 hover:bg-surface',
                        label: 'w-full',
                      }}
                    >
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[15px] font-medium text-ink">{c.name}</span>
                        {c.invite_status === 'invited' && (
                          <span className="shrink-0 text-xs text-status-pending-text">
                            {t('officials.invited')}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-label">
                        {formatPhoneForDisplay(c.phone)}
                        {c.events.length > 0 && <> · {c.events.join(', ')}</>}
                      </span>
                    </Checkbox>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-ink-faint">{t('officials.fromEvents.notice')}</p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="bordered"
            className="rounded-control border-edge"
            onPress={close}
            isDisabled={isPending}
          >
            {t('officials.cancel')}
          </Button>
          <Button
            color="primary"
            isDisabled={selected.size === 0}
            isLoading={isPending}
            onPress={submit}
          >
            {selected.size > 0
              ? t('officials.fromEvents.addCount', { n: selected.size })
              : t('officials.fromEvents.add')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
