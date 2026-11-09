'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp } from '@gravity-ui/icons'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/confirm-dialog'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import type { InfoSection } from '@/lib/events/info-sections'
import { deleteInfoSection, reorderInfoSections } from '../info-section-actions'
import InfoSectionModal from './info-section-modal'

interface Props {
  tenantId: string
  eventId: string
  /** From get_admin_event_cached, in position order. */
  sections: InfoSection[]
}

// EVT-02 "Info sections" (N38, L23, L24). Every change is written at once —
// add/edit through the modal, remove after a confirm, reorder on each move —
// and the page data is then refreshed from the server. None of it goes
// through the form's Save button or its unsaved-changes guard.
export function InfoSectionsEditor({ tenantId, eventId, sections }: Props) {
  const { t } = useTranslation('admin')
  const { t: tc } = useTranslation('common')
  const router = useRouter()
  const [, startRefresh] = useTransition()

  // Local order, so a move shows at once while the RPC runs. Re-synced from
  // the prop whenever the server sends a new list (after router.refresh()) —
  // holding on to the first render's copy is the stale-state bug the
  // scheduling grid once had.
  const [order, setOrder] = useState(sections)
  const [seen, setSeen] = useState(sections)
  if (seen !== sections) {
    setSeen(sections)
    setOrder(sections)
  }

  const [modal, setModal] = useState<{ section: InfoSection | null } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InfoSection | null>(null)
  const [busy, setBusy] = useState(false)

  function refresh() {
    startRefresh(() => router.refresh())
  }

  async function move(index: number, delta: -1 | 1) {
    const target = index + delta
    if (target < 0 || target >= order.length || busy) return
    const previous = order
    const next = [...order]
    ;[next[index], next[target]] = [next[target], next[index]]
    setOrder(next)
    setBusy(true)
    try {
      const result = await reorderInfoSections(
        tenantId,
        eventId,
        next.map((s) => s.id)
      )
      if (result.error) {
        setOrder(previous)
        toastError(result.error)
      } else {
        refresh()
      }
    } catch {
      setOrder(previous)
      toastError(t('eventConfig.infoSectionSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    setBusy(true)
    try {
      const result = await deleteInfoSection(tenantId, eventId, target.id)
      if (result.error) toastError(result.error)
      else {
        setOrder((prev) => prev.filter((s) => s.id !== target.id))
        refresh()
      }
    } catch {
      toastError(t('eventConfig.infoSectionSaveFailed'))
    } finally {
      setBusy(false)
    }
  }

  function kinds(s: InfoSection): string {
    return [
      s.body ? t('eventConfig.infoSectionKindText') : null,
      s.image_path ? t('eventConfig.infoSectionKindImage') : null,
      s.link_url ? t('eventConfig.infoSectionKindLink') : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return (
    <>
      <div className="overflow-hidden rounded-large">
        <div className="flex items-center justify-between gap-3 border-b border-edge px-4 py-3.5">
          <span className="section-label">{t('eventConfig.infoSections')}</span>
          <Button
            type="button"
            variant="bordered"
            size="sm"
            onPress={() => setModal({ section: null })}
            className="rounded-control border-tenant-primary bg-white px-4 font-semibold text-tenant-primary"
          >
            {t('eventConfig.addInfoSection')}
          </Button>
        </div>

        {order.length === 0 ? (
          <p className="px-4 py-5 text-[14px] text-ink-muted">{t('eventConfig.noInfoSections')}</p>
        ) : (
          <ul className="divide-y divide-edge-soft">
            {order.map((section, i) => (
              <li key={section.id} className="flex items-center gap-2 px-2 py-2.5 sm:px-3">
                {/* Up/down rather than drag: works by keyboard and on a
                    touch screen without a drag library, and each press is
                    one atomic reorder (reorder_event_info_sections). */}
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    disabled={i === 0 || busy}
                    aria-label={t('eventConfig.infoSectionMoveUp', { title: section.title })}
                    className="flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-black/5 hover:text-tenant-primary disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronUp width={14} height={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === order.length - 1 || busy}
                    aria-label={t('eventConfig.infoSectionMoveDown', { title: section.title })}
                    className="flex size-7 items-center justify-center rounded-md text-ink-faint hover:bg-black/5 hover:text-tenant-primary disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ChevronDown width={14} height={14} aria-hidden="true" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-ink">{section.title}</p>
                  <p className="text-[13px] text-ink-muted">{kinds(section)}</p>
                </div>

                <div className="flex shrink-0 items-center">
                  <Button
                    size="sm"
                    variant="light"
                    onPress={() => setModal({ section })}
                    isDisabled={busy}
                    className="font-medium text-tenant-primary-tint-text"
                  >
                    {tc('actions.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="light"
                    color="danger"
                    onPress={() => setDeleteTarget(section)}
                    isDisabled={busy}
                    className="font-medium text-destructive"
                  >
                    {tc('actions.remove')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {modal ? (
        <InfoSectionModal
          tenantId={tenantId}
          eventId={eventId}
          section={modal.section}
          onSaved={() => {
            setModal(null)
            refresh()
          }}
          onClose={() => setModal(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={tc('actions.remove')}
        body={t('eventConfig.deleteInfoSectionConfirm', { title: deleteTarget?.title ?? '' })}
        cancelLabel={tc('actions.cancel')}
        confirmLabel={tc('actions.remove')}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        destructive
      />
    </>
  )
}
