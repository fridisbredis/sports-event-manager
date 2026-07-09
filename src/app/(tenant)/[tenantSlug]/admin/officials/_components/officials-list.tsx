'use client'

import { useState } from 'react'
import {
  Button,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
} from '@heroui/react'
import { useTranslation } from '@/lib/i18n/client'
import ConfirmDialog from '@/components/confirm-dialog'
import type { Official } from '@/types/app'

interface Props {
  tenantSlug: string
  tenantId: string
  officials: Official[]
  currentUserId: string
}

export default function OfficialsList({ tenantId, officials: initialOfficials, currentUserId }: Props) {
  const { t } = useTranslation('admin')
  const [officials, setOfficials] = useState<Official[]>(initialOfficials)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Official | null>(null)
  const [pending, setPending] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')

  async function handleAdd() {
    if (!name.trim() || !phone.trim() || pending) return
    setPending(true)
    setAddError(null)
    try {
      const res = await fetch('/api/officials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, name: name.trim(), phone: phone.trim() }),
      })
      if (res.ok) {
        const { official } = await res.json()
        setOfficials((prev) => [...prev, official])
        setName('')
        setPhone('')
        setAddModalOpen(false)
      } else if (res.status === 401) {
        setAddError('Session expired — please refresh the page and try again.')
      } else {
        const body = await res.json().catch(() => ({}))
        setAddError(body?.error ?? `Error ${res.status}`)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleRemove() {
    if (!removeTarget) return
    setPending(true)
    try {
      const res = await fetch(`/api/officials/${removeTarget.id}?tenantId=${tenantId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setOfficials((prev) => prev.filter((o) => o.id !== removeTarget.id))
        setRemoveTarget(null)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleResend(official: Official) {
    setResendingId(official.id)
    try {
      await fetch(`/api/officials/${official.id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
    } finally {
      setResendingId(null)
    }
  }

  const visibleOfficials = officials.filter((o) => o.invite_status !== 'removed')

  function closeAddModal() {
    setAddModalOpen(false)
    setName('')
    setPhone('')
    setAddError(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{t('officials.title')}</h1>
        <Button color="primary" onPress={() => setAddModalOpen(true)}>
          {t('officials.add')}
        </Button>
      </div>

      {visibleOfficials.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-20 text-center">
          <svg
            className="mb-4 h-12 w-12 text-gray-300"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="8" y="8" width="32" height="32" rx="2" />
            <line x1="8" y1="8" x2="40" y2="40" />
            <line x1="40" y1="8" x2="8" y2="40" />
          </svg>
          <p className="text-base font-medium text-gray-900 mb-1">{t('officials.empty')}</p>
          <p className="text-sm text-gray-500 mb-6">{t('officials.emptyHint')}</p>
          <Button color="primary" onPress={() => setAddModalOpen(true)}>
            {t('officials.add')}
          </Button>
        </div>
      ) : (
        <Table isStriped aria-label={t('officials.title')}>
          <TableHeader>
            <TableColumn>{t('officials.name')}</TableColumn>
            <TableColumn>{t('officials.phone')}</TableColumn>
            <TableColumn>{t('officials.status')}</TableColumn>
            <TableColumn>{t('officials.actions')}</TableColumn>
          </TableHeader>
          <TableBody>
            {visibleOfficials.map((official) => {
              const isCurrentUser = official.user_id === currentUserId
              const isResending = resendingId === official.id

              return (
                <TableRow key={official.id}>
                  <TableCell className="font-medium text-gray-900">
                    {isCurrentUser ? `${official.name} — ${t('officials.youLabel')}` : official.name}
                  </TableCell>
                  <TableCell className="text-gray-500">{official.phone}</TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" color={official.invite_status === 'confirmed' ? 'default' : 'warning'}>
                      {official.invite_status === 'confirmed' ? t('officials.confirmed') : t('officials.invited')}
                    </Chip>
                  </TableCell>
                  <TableCell>
                    {!isCurrentUser && (
                      <div className="flex items-center gap-2">
                        {official.invite_status === 'invited' && (
                          <Button
                            size="sm"
                            variant="bordered"
                            isLoading={isResending}
                            onPress={() => handleResend(official)}
                          >
                            {t('officials.resendInvite')}
                          </Button>
                        )}
                        <Button size="sm" variant="bordered" onPress={() => setRemoveTarget(official)}>
                          {t('officials.remove')}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <Modal isOpen={addModalOpen} onOpenChange={(isOpen) => !isOpen && closeAddModal()}>
        <ModalContent>
          <ModalHeader>{t('officials.addTitle')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('officials.name')}
              value={name}
              onValueChange={setName}
              placeholder={t('officials.namePlaceholder')}
              autoFocus
            />
            <Input
              label={t('officials.phone')}
              type="tel"
              value={phone}
              onValueChange={setPhone}
              placeholder="+46 70 000 00 00"
              description={t('officials.phoneHint')}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              isInvalid={!!addError}
              errorMessage={addError}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeAddModal}>
              {t('officials.cancel')}
            </Button>
            <Button
              color="primary"
              isDisabled={!name.trim() || !phone.trim()}
              isLoading={pending}
              onPress={handleAdd}
            >
              {t('officials.sendInvite')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('officials.removeConfirmTitle')}
        body={t('officials.removeConfirmBody', { name: removeTarget?.name ?? '' })}
        cancelLabel={t('officials.cancel')}
        confirmLabel={t('officials.remove')}
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />
    </div>
  )
}
