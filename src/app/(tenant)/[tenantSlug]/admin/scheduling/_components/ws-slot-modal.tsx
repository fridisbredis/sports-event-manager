import { Button, Modal, ModalContent, ModalHeader, ModalBody, ScrollShadow } from '@heroui/react'
import { Input } from '@/components/ui/form-fields'
import { formatSlotLabel } from '@/lib/scheduling/grid-logic'
import { useTranslation } from '@/lib/i18n/client'
import type { OfficialData, LocalAssignment } from './scheduling-types'
import type { WsSlotModal as WsSlotModalState } from './use-scheduling-grid-interaction'

interface WsSlotModalProps {
  wsSlotModal: NonNullable<WsSlotModalState>
  wsSlotModalSearch: string
  onSearchChange: (value: string) => void
  activeAssignments: LocalAssignment[]
  officials: OfficialData[]
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
  const availableOfficialsAll = officials.filter((off) => !assignedAtSlot.has(off.id))
  const availableOfficials = availableOfficialsAll.filter((off) =>
    off.name.toLowerCase().includes(wsSlotModalSearch.toLowerCase())
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
              {assignedInSlot.length === 0 && availableOfficialsAll.length === 0 && (
                <p className="text-sm text-gray-400">{t('scheduling.slotModalEmpty')}</p>
              )}

              {assignedInSlot.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {t('scheduling.slotModalAssigned')}
                  </p>
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

              {assignedInSlot.length === 0 && availableOfficialsAll.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    {t('scheduling.slotModalAvailable', { time: formatSlotLabel(slot) })}
                  </p>
                  <Input
                    type="text"
                    size="sm"
                    placeholder={t('scheduling.slotModalSearchPlaceholder')}
                    value={wsSlotModalSearch}
                    onValueChange={onSearchChange}
                    className="mb-2"
                  />
                  {availableOfficials.length === 0 ? (
                    <p className="text-sm text-gray-400 px-1 py-2">
                      {t('scheduling.slotModalNoResults')}
                    </p>
                  ) : (
                    <ScrollShadow className="flex flex-col max-h-80 divide-y divide-gray-100">
                      {availableOfficials.map((off) => (
                        <div key={off.id} className="flex items-center justify-between px-2 py-1.5">
                          <span className="text-sm text-gray-900">{off.name}</span>
                          <Button variant="bordered" size="sm" onPress={() => onAdd(off.id)}>
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
