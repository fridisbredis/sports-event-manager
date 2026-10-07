import { Modal, ModalContent, ModalHeader, ModalBody, ScrollShadow } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/form-fields'
import { formatSlotLabel } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import type { OfficialData, LocalAssignment } from './scheduling-types'
import type { WsSlotModal as WsSlotModalState } from './use-scheduling-grid-interaction'

/**
 * What the picker says about one official at this slot.
 *
 * Ordered by how much it should discourage picking that person, which is also
 * the order the list sorts in: free first, a declared absence next (allowed,
 * but say so), already working last.
 */
type PickerStatus = 'available' | 'timeOff' | 'assigned'

const STATUS_ORDER: Record<PickerStatus, number> = {
  available: 0,
  timeOff: 1,
  assigned: 2,
}

interface WsSlotModalProps {
  wsSlotModal: NonNullable<WsSlotModalState>
  wsSlotModalSearch: string
  onSearchChange: (value: string) => void
  activeAssignments: LocalAssignment[]
  officials: OfficialData[]
  /** `officialId:slotStartISO` keys covered by a self-reported absence. */
  unavailableSlots: Set<string>
  onRemove: (assignment: LocalAssignment) => void
  onAdd: (officialId: string) => void
  onClose: () => void
}

export function WsSlotModal({
  wsSlotModal,
  wsSlotModalSearch,
  onSearchChange,
  activeAssignments,
  officials,
  unavailableSlots,
  onRemove,
  onAdd,
  onClose,
}: WsSlotModalProps) {
  const { t } = useTranslation('admin')

  const slot = new Date(wsSlotModal.slotStart)
  const assignedInSlot = activeAssignments.filter(
    (a) =>
      a.workstation_id === wsSlotModal.workstationId &&
      a.timeslot_start === wsSlotModal.slotStart &&
      a.slot_index === wsSlotModal.slotIndex
  )
  const assignedAtSlot = new Set(
    activeAssignments
      .filter((a) => a.timeslot_start === wsSlotModal.slotStart)
      .map((a) => a.official_id)
  )

  // Every official, each carrying why they are or are not a good pick —
  // rather than silently dropping the ones already working this slot. Hiding
  // them answered "who can I add" but not "where is everyone", so an admin
  // looking for a specific person found an absence with no explanation. The
  // status says which, and Add stays enabled either way: both an absence and
  // a clash are warnings here, not blocks.
  const candidatesAll = officials
    .map((off) => {
      const status: PickerStatus = assignedAtSlot.has(off.id)
        ? 'assigned'
        : unavailableSlots.has(`${off.id}:${wsSlotModal.slotStart}`)
          ? 'timeOff'
          : 'available'
      return { official: off, status }
    })
    .sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        a.official.name.localeCompare(b.official.name)
    )

  const candidates = candidatesAll.filter((c) =>
    c.official.name.toLowerCase().includes(wsSlotModalSearch.toLowerCase())
  )

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
            <ModalHeader className="flex flex-col gap-1 text-sm font-semibold">
              {t('scheduling.slotModalTitle', {
                index: wsSlotModal.slotIndex,
                ws: wsSlotModal.wsName,
                time: formatSlotLabel(slot),
              })}
            </ModalHeader>
            <ModalBody>
              {assignedInSlot.length === 0 && candidatesAll.length === 0 && (
                <p className="text-sm text-ink-label">{t('scheduling.slotModalEmpty')}</p>
              )}

              {assignedInSlot.length > 0 && (
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

              {assignedInSlot.length === 0 && candidatesAll.length > 0 && (
                <div>
                  <p className="section-label mb-2">
                    {t('scheduling.slotModalAvailable', { time: formatSlotLabel(slot) })}
                  </p>
                  <Input
                    type="text"
                    size="sm"
                    placeholder={t('scheduling.slotModalSearchPlaceholder')}
                    // Named off the same string as the placeholder: a
                    // placeholder is not exposed as an accessible name, and
                    // vanishes once the field has text.
                    aria-label={t('scheduling.slotModalSearchPlaceholder')}
                    value={wsSlotModalSearch}
                    onValueChange={onSearchChange}
                    className="mb-2"
                  />
                  {candidates.length === 0 ? (
                    <p className="text-sm text-ink-label px-1 py-2">
                      {t('scheduling.slotModalNoResults')}
                    </p>
                  ) : (
                    <ScrollShadow className="flex flex-col max-h-80 divide-y divide-gray-100">
                      {candidates.map(({ official, status }) => (
                        <div
                          key={official.id}
                          className="flex items-center justify-between gap-3 px-2 py-2"
                        >
                          <div className="flex min-w-0 flex-col items-start gap-1">
                            <span className="truncate text-sm text-gray-900">{official.name}</span>
                            {/* Success / warning / danger, matching what each
                                state means elsewhere on this screen: a clash
                                is the red one the grid already uses, and a
                                declared absence the amber advisory. */}
                            <Chip
                              size="sm"
                              variant="flat"
                              color={
                                status === 'available'
                                  ? 'success'
                                  : status === 'timeOff'
                                    ? 'warning'
                                    : 'danger'
                              }
                            >
                              {t(`scheduling.slotModalStatus.${status}`)}
                            </Chip>
                          </div>
                          <Button
                            variant="bordered"
                            size="sm"
                            className="shrink-0"
                            onPress={() => onAdd(official.id)}
                          >
                            {t('scheduling.slotModalAdd')}
                          </Button>
                        </div>
                      ))}
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
