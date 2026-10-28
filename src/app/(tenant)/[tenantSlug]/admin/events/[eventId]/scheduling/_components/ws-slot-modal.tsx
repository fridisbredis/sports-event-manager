import { Modal, ModalContent, ModalHeader, ModalBody, ScrollShadow } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { BLOCKED_PICKER_STATUSES, sortCandidates } from './grid-helpers'
import { useArmedAfterGesture } from './use-armed-after-gesture'
import type { LocalAssignment, OfficialData, PickerCandidate } from './scheduling-types'

interface WsSlotModalProps {
  /** Modal heading — differs between a single slot and a painted run. */
  title: string
  /** Label above the list, naming what the picks apply to. */
  listLabel: string
  candidates: PickerCandidate[]
  search: string
  onSearchChange: (value: string) => void
  /** Already-assigned people to offer removal for; empty for a painted run. */
  assignedInSlot: LocalAssignment[]
  officials: OfficialData[]
  onRemove?: (assignment: LocalAssignment) => void
  onAdd: (officialId: string) => void
  onClose: () => void
  /**
   * Whether the pointer was still down when this opened — true for the
   * drag-to-paint gesture, false for an ordinary click on a cell.
   */
  openedMidGesture?: boolean
}

export function WsSlotModal({
  title,
  listLabel,
  candidates,
  search,
  onSearchChange,
  assignedInSlot,
  officials,
  onRemove,
  onAdd,
  onClose,
  openedMidGesture = false,
}: WsSlotModalProps) {
  const { t } = useTranslation('admin')

  const armed = useArmedAfterGesture(openedMidGesture)

  const sorted = sortCandidates(candidates)
  const visible = sorted.filter((c) => c.official.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <Modal
      isOpen
      size="2xl"
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
      classNames={{ base: 'bg-gray-50' }}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1 text-sm font-semibold">{title}</ModalHeader>
            <ModalBody>
              {assignedInSlot.length === 0 && sorted.length === 0 && (
                <p className="text-sm text-ink-label">{t('scheduling.slotModalEmpty')}</p>
              )}

              {assignedInSlot.length > 0 && onRemove && (
                <div>
                  <p className="section-label mb-2">{t('scheduling.slotModalAssigned')}</p>
                  {assignedInSlot.map((a) => {
                    const off = officials.find((o) => o.id === a.official_id)
                    return (
                      <div
                        key={a.official_id}
                        className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 mb-2"
                      >
                        <span className="text-sm text-gray-900">{off?.name ?? '—'}</span>
                        <Button
                          color="danger"
                          variant="light"
                          size="sm"
                          onPress={() => onRemove(a)}
                        >
                          {t('scheduling.slotModalRemove')}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}

              {assignedInSlot.length === 0 && sorted.length > 0 && (
                <div>
                  <p className="section-label mb-2">{listLabel}</p>
                  <Input
                    type="text"
                    size="sm"
                    placeholder={t('scheduling.slotModalSearchPlaceholder')}
                    // Named off the same string as the placeholder: a
                    // placeholder is not exposed as an accessible name, and
                    // vanishes once the field has text.
                    aria-label={t('scheduling.slotModalSearchPlaceholder')}
                    value={search}
                    onValueChange={onSearchChange}
                    className="mb-2"
                  />
                  {visible.length === 0 ? (
                    <p className="text-sm text-ink-label px-1 py-2">
                      {t('scheduling.slotModalNoResults')}
                    </p>
                  ) : (
                    <ScrollShadow className="flex max-h-80 flex-col gap-0.5">
                      {visible.map(({ official, status }) => {
                        const blocked = BLOCKED_PICKER_STATUSES.has(status)
                        return (
                          // The whole row is the control, not just the button
                          // at its end: the row is what an admin aims at, and
                          // a 40px-wide target beside a full-width row reads
                          // as a slip waiting to happen. "Add" stays as the
                          // affordance that says what a click does, but it is
                          // painted rather than focusable — two tab stops per
                          // person would double the keyboard path for no gain.
                          //
                          // A div with a button role rather than a <button>:
                          // HeroUI's Chip renders a div, and a div inside a
                          // button is invalid nesting that the browser
                          // repairs by hoisting it OUT of the button —
                          // which silently cost the name its click target.
                          //
                          // Disabled, not hidden: an admin looking for a
                          // person needs to find them and see why they are
                          // unavailable. The server refuses these too — the
                          // disabled state is a courtesy, not the guard.
                          <div
                            key={official.id}
                            role="button"
                            tabIndex={blocked ? -1 : 0}
                            aria-disabled={blocked}
                            onClick={() => {
                              if (!blocked && armed) onAdd(official.id)
                            }}
                            onKeyDown={(e) => {
                              if (blocked) return
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                onAdd(official.id)
                              }
                            }}
                            className={`flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                              blocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100'
                            }`}
                          >
                            <span className="truncate text-sm text-gray-900">{official.name}</span>
                            {/* Status and action sit together at the end of
                                the row: the chip qualifies the Add beside it
                                — why this one is dimmed — so reading them as
                                one unit beats a stacked two-line row. */}
                            <span className="flex shrink-0 items-center gap-2">
                              {/* Green for pickable, red for an outright clash,
                                  amber for either kind of time off — matching
                                  the hatches on the grid itself. */}
                              <Chip
                                size="sm"
                                variant="flat"
                                color={
                                  status === 'available'
                                    ? 'success'
                                    : status === 'assigned'
                                      ? 'danger'
                                      : 'warning'
                                }
                              >
                                {t(`scheduling.slotModalStatus.${status}`)}
                              </Chip>
                              <span
                                aria-hidden="true"
                                className={`rounded-md border px-3 py-1 text-xs ${
                                  blocked
                                    ? 'border-gray-200 text-gray-300'
                                    : 'border-gray-300 text-gray-700'
                                }`}
                              >
                                {t('scheduling.slotModalAdd')}
                              </span>
                            </span>
                          </div>
                        )
                      })}
                    </ScrollShadow>
                  )}
                </div>
              )}
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}
