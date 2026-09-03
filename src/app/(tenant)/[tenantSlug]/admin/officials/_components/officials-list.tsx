'use client'

import { useState } from 'react'
import {
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
  SelectItem,
} from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form-fields'
import { AppCard } from '@/components/ui/app-card'
import { useTranslation } from '@/lib/i18n/client'
import ConfirmDialog from '@/components/confirm-dialog'
import { toastError, extractErrorMessage, parseRetryAfterMinutes } from '@/lib/toast'
import { logger } from '@/lib/logger'
import {
  isValidPhoneForCountry,
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  formatPhoneForDisplay,
} from '@/lib/phone'
import type { OfficialListItem } from '@/types/app'

interface Props {
  tenantSlug: string
  tenantId: string
  officials: OfficialListItem[]
  currentUserId: string
}

export default function OfficialsList({
  tenantId,
  officials: initialOfficials,
  currentUserId,
}: Props) {
  const { t } = useTranslation('admin')
  const [officials, setOfficials] = useState<OfficialListItem[]>(initialOfficials)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<OfficialListItem | null>(null)
  const [resendTarget, setResendTarget] = useState<OfficialListItem | null>(null)
  const [pending, setPending] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY)

  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)

  async function handleAdd() {
    if (!name.trim() || !phoneIsValid || pending) return
    setPending(true)
    setAddError(null)
    try {
      const res = await fetch('/api/officials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          name: name.trim(),
          phone: phone.trim(),
          phoneCountry,
        }),
      })
      if (res.ok) {
        const { official, smsSent } = await res.json()
        setOfficials((prev) => [...prev, official])
        setName('')
        setPhone('')
        setPhoneCountry(DEFAULT_PHONE_COUNTRY)
        setAddModalOpen(false)
        // The official exists either way — only the invite SMS can have failed here.
        if (smsSent === false) {
          toastError(t('officials.addedSmsFailed', { name: official.name }))
        }
      } else if (res.status === 409) {
        // Same number as an active official in this tenant. Names may repeat, numbers may not.
        const message = t('officials.duplicatePhone')
        setAddError(message)
        toastError(message)
      } else if (res.status === 400) {
        const message = t('officials.invalidPhone')
        setAddError(message)
        toastError(message)
      } else if (res.status === 401) {
        const message = t('officials.sessionExpired')
        setAddError(message)
        toastError(message)
      } else if (res.status === 429) {
        // Tenant-level invite-attempt ceiling — not a problem with the phone number
        // itself, so this must not populate addError (which drives the phone field's
        // invalid state).
        const minutes = parseRetryAfterMinutes(res)
        toastError(t('officials.addRateLimited', { count: minutes, minutes }))
      } else if (res.status === 503) {
        // The rate-limit check itself failed (DB unavailable) — transient, not a
        // problem with the phone number, so this must not populate addError.
        toastError(t('officials.addServiceUnavailable'))
      } else {
        const body = await res.json().catch(() => ({}))
        logger.error('Unexpected /api/officials error response', undefined, {
          status: res.status,
          message: extractErrorMessage(body, `Error ${res.status}`),
        })
        const message = t('officials.addUnexpectedError')
        setAddError(message)
        toastError(message)
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
      } else {
        toastError(t('officials.removeError', { name: removeTarget.name }))
      }
    } finally {
      setPending(false)
    }
  }

  async function handleResend(official: OfficialListItem) {
    setResendTarget(null)
    setResendingId(official.id)
    try {
      const res = await fetch(`/api/officials/${official.id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (res.status === 502) {
        // Only a 502 (SMS send rejected) happens after the token is rotated, so the
        // official's old invite link is genuinely dead and no new one arrived.
        toastError(t('officials.resendError', { name: official.name }))
      } else if (res.status === 429) {
        // Rate limited before rotation — the existing invite link still works.
        const minutes = parseRetryAfterMinutes(res)
        toastError(t('officials.resendRateLimited', { count: minutes, minutes }))
      } else if (res.status === 401) {
        toastError(t('officials.sessionExpired'))
      } else if (res.status === 503) {
        // The rate-limit check itself failed (DB unavailable) before rotation — the
        // official's existing invite link still works and this is transient.
        toastError(t('officials.resendServiceUnavailable'))
      } else if (res.status === 400 || res.status === 404) {
        toastError(t('officials.resendOfficialUnavailable'))
      } else if (!res.ok) {
        toastError(t('officials.resendConfigError'))
      }
    } finally {
      setResendingId(null)
    }
  }

  const visibleOfficials = officials.filter((o) => o.invite_status !== 'removed')

  function closeAddModal() {
    setAddModalOpen(false)
    setName('')
    setPhone('')
    setPhoneCountry(DEFAULT_PHONE_COUNTRY)
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
        <AppCard bodyClassName="flex flex-col items-center justify-center py-20 text-center">
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
        </AppCard>
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
                    {isCurrentUser
                      ? `${official.name} — ${t('officials.youLabel')}`
                      : official.name}
                  </TableCell>
                  <TableCell className="text-gray-500">
                    {formatPhoneForDisplay(official.phone)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={official.invite_status === 'confirmed' ? 'default' : 'warning'}
                    >
                      {official.invite_status === 'confirmed'
                        ? t('officials.confirmed')
                        : t('officials.invited')}
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
                            onPress={() => setResendTarget(official)}
                          >
                            {t('officials.resendInvite')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="bordered"
                          onPress={() => setRemoveTarget(official)}
                        >
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

      <Modal
        isOpen={addModalOpen}
        onOpenChange={(isOpen) => !isOpen && closeAddModal()}
        classNames={{ base: 'bg-gray-50' }}
      >
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
            <div className="flex gap-2">
              <Select
                label={t('officials.phoneCountry')}
                className="w-56"
                selectedKeys={[phoneCountry]}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0] as string
                  setPhoneCountry(next as typeof phoneCountry)
                  setAddError(null)
                }}
              >
                {PHONE_COUNTRIES.map((c) => (
                  <SelectItem key={c.code} textValue={c.label}>
                    {c.label}
                  </SelectItem>
                ))}
              </Select>
              <Input
                label={t('officials.phone')}
                type="tel"
                value={phone}
                onValueChange={(value) => {
                  setPhone(value)
                  setAddError(null)
                }}
                placeholder={t('officials.phonePlaceholder')}
                description={t('officials.phoneHint')}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                isInvalid={!!addError || (phone.trim() !== '' && !phoneIsValid)}
                errorMessage={
                  addError ??
                  (phone.trim() !== '' && !phoneIsValid ? t('officials.invalidPhone') : undefined)
                }
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeAddModal}>
              {t('officials.cancel')}
            </Button>
            <Button
              color="primary"
              isDisabled={!name.trim() || !phoneIsValid}
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

      <ConfirmDialog
        open={resendTarget !== null}
        title={t('officials.resendConfirmTitle')}
        body={t('officials.resendConfirmBody', { name: resendTarget?.name ?? '' })}
        cancelLabel={t('officials.cancel')}
        confirmLabel={t('officials.resendInvite')}
        onCancel={() => setResendTarget(null)}
        onConfirm={() => resendTarget && handleResend(resendTarget)}
      />
    </div>
  )
}
