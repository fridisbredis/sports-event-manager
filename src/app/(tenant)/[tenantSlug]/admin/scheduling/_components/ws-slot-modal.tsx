import { Modal, ModalContent, ModalHeader, ModalBody, ScrollShadow } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/form-fields'
import { formatSlotLabel } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import { dominantAuthor, type UnavailabilityPeriod } from '@/lib/scheduling/unavailability'
import type { OfficialData, LocalAssignment } from './scheduling-types'
import type { WsSlotModal as WsSlotModalState } from './use-scheduling-grid-interaction'

/**
 * What the picker says about one official at this slot.
 *
 * Ordered by how much it should discourage picking that person, which is also
 * the order the list sorts in: free first, then the two that cannot be picked
 * at all — time off (blocked since Peter's call of 2026-10-07) and already
 * working.
 */
type PickerStatus = 'available' | 'timeOff' | 'timeOffAdmin' | 'assigned'

const STATUS_ORDER: Record<PickerStatus, number> = {
  available: 0,
  timeOff: 1,
  timeOffAdmin: 2,
  assigned: 3,
}

/** Which statuses make a person unpickable for this slot. */
const BLOCKED: ReadonlySet<PickerStatus> = new Set<PickerStatus>([
  'timeOff',
  'timeOffAdmin',
  'assigned',
])

interface WsSlotModalProps {
  wsSlotModal: NonNullable<WsSlotModalState>
  wsSlotModalSearch: string
  onSearchChange: (value: string) => void
  activeAssignments: LocalAssignment[]
  officials: OfficialData[]
  /** `officialId:slotStartISO` keys covered by any kind of time off. */
  unavailableSlots: Set<string>
  /** The periods behind those keys, to tell admin-set from self-declared. */
  periodsByCell: Map<string, UnavailabilityPeriod[]>
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
  periodsByCell,
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
  // rather than silently dropping the ones who cannot be picked. Hiding them
  // answered "who can I add" but not "where is everyone", so an admin looking
  // for a specific person found an absence with no explanation. The status
  // says which, and Add is disabled for the ones the server would refuse.
  const candidatesAll = officials
    .map((off) => {
      const cellKey = `${off.id}:${wsSlotModal.slotStart}`
      let status: PickerStatus = 'available'
      if (assignedAtSlot.has(off.id)) {
        status = 'assigned'
      } else if (unavailableSlots.has(cellKey)) {
        status =
          dominantAuthor(periodsByCell.get(cellKey) ?? []) === 'tenant_admin'
            ? 'timeOffAdmin'
            : 'timeOff'
      }
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
                          </div>
                          {/* Disabled, not hidden: an admin looking for a
                              person needs to find them and see why they are
                              unavailable. The server refuses these too — the
                              disabled state is a courtesy, not the guard. */}
                          <Button
                            variant="bordered"
                            size="sm"
                            className="shrink-0"
                            isDisabled={BLOCKED.has(status)}
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
