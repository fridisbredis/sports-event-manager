'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, SelectItem } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { SystemButton } from '../../_components/system-button'
import { Input, Select } from '@/components/ui/form-fields'
import ConfirmDialog from '@/components/confirm-dialog'
import { toastError } from '@/lib/toast'
import { useTranslation } from '@/lib/i18n/client'
import {
  isValidPhoneForCountry,
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  formatPhoneForDisplay,
} from '@/lib/phone'
import { grantSystemAdmin, revokeSystemAdmin } from '../../actions'
import type { SystemAdmin } from '@/lib/auth/system-admins'

interface Props {
  admins: SystemAdmin[]
  // The signed-in admin, whose own row gets no remove button — the action
  // refuses self-removal too.
  currentUserId: string
  // Formatted server-side, as on SYS-02 (B7).
  formattedDates: Record<string, string>
}

// Deliberately the same shape as SYS-02's TenantAdminsSection, so the two
// admin lists read as one pattern. What differs: no tier cap, and the
// signed-in admin cannot remove themselves.
export function SystemAdminsSection({ admins, currentUserId, formattedDates }: Props) {
  const { t } = useTranslation('admin')
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY)
  const [pending, setPending] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<SystemAdmin | null>(null)
  const [removePending, setRemovePending] = useState(false)

  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)
  const canSubmit = name.trim() !== '' && phoneIsValid
  // The RPC refuses this too; disabling explains it before the click.
  const isLastAdmin = admins.length <= 1

  async function handleAdd() {
    if (!canSubmit || pending) return
    setPending(true)
    setAddError(null)
    const result = await grantSystemAdmin(name.trim(), phone.trim(), phoneCountry)
    if (result.error) {
      setAddError(result.error)
      toastError(result.error)
    } else {
      setName('')
      setPhone('')
      setPhoneCountry(DEFAULT_PHONE_COUNTRY)
      setAddOpen(false)
    }
    setPending(false)
  }

  async function handleRemove() {
    if (!removing || removePending) return
    setRemovePending(true)
    const result = await revokeSystemAdmin(removing.userId)
    if (result.error) toastError(result.error)
    setRemovePending(false)
    setRemoving(null)
  }

  function closeAdd() {
    if (pending) return
    setAddOpen(false)
    setName('')
    setPhone('')
    setPhoneCountry(DEFAULT_PHONE_COUNTRY)
    setAddError(null)
  }

  return (
    <div className="p-6">
      {/* No section heading: the page's h1 already says "System admins", and
          this card is the page's only content. */}
      <p className="mb-4 text-sm text-ink-label">{t('systemAdmin.systemAdminsHint')}</p>

      <ul className="divide-y divide-edge-soft">
        {admins.map((admin) => {
          const isSelf = admin.userId === currentUserId
          // Why the button is dead, if it is. Self first: for the last admin
          // that is also the signed-in one, "you cannot remove yourself" is
          // the reason that applies regardless of the count.
          const disabledReason = isSelf
            ? t('systemAdmin.cannotRemoveSelfHint')
            : isLastAdmin
              ? t('systemAdmin.lastSystemAdminHint')
              : undefined

          return (
            <li key={admin.userId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
                  <span className="truncate">
                    {admin.name ?? (
                      <span className="font-normal italic text-ink-label">
                        {t('systemAdmin.adminUnknownName')}
                      </span>
                    )}
                  </span>
                  {isSelf && (
                    <span className="shrink-0 rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-semibold text-ink-soft">
                      {t('systemAdmin.systemAdminYou')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-label">
                  {/* Compared raw, formatted for display: a name that is
                      just the stored number would otherwise repeat it. */}
                  {admin.phone && admin.phone !== admin.name
                    ? `${formatPhoneForDisplay(admin.phone)} · `
                    : ''}
                  {t('systemAdmin.adminAddedOn', { date: formattedDates[admin.userId] ?? '' })}
                </p>
              </div>
              <Button
                variant="bordered"
                size="sm"
                onPress={() => setRemoving(admin)}
                isDisabled={disabledReason !== undefined}
                // The repo's `destructive` token, as on SYS-02.
                className="shrink-0 border-destructive text-destructive"
                title={disabledReason}
              >
                {t('systemAdmin.removeAdmin')}
              </Button>
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
        <SystemButton onPress={() => setAddOpen(true)} className="w-full sm:w-auto">
          {t('systemAdmin.addSystemAdmin')}
        </SystemButton>
      </div>

      <Modal isOpen={addOpen} onOpenChange={closeAdd} size="lg">
        <ModalContent>
          <ModalHeader>{t('systemAdmin.addSystemAdmin')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('systemAdmin.addAdminName')}
              value={name}
              onValueChange={(value) => {
                setName(value)
                setAddError(null)
              }}
              placeholder={t('systemAdmin.addAdminNamePlaceholder')}
              autoFocus
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                label={t('systemAdmin.addAdminCountry')}
                className="w-full sm:w-52 sm:shrink-0"
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
                label={t('systemAdmin.addAdminPhone')}
                className="flex-1"
                type="tel"
                value={phone}
                onValueChange={(value) => {
                  setPhone(value)
                  setAddError(null)
                }}
              />
            </div>
            <p className="text-sm text-ink-label">{t('systemAdmin.addSystemAdminHint')}</p>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeAdd} isDisabled={pending}>
              {t('systemAdmin.cancel')}
            </Button>
            <SystemButton onPress={handleAdd} isDisabled={!canSubmit} isLoading={pending}>
              {t('systemAdmin.addSystemAdmin')}
            </SystemButton>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={handleRemove}
        title={t('systemAdmin.removeSystemAdminConfirmTitle')}
        body={
          removing?.name || removing?.phone
            ? t('systemAdmin.removeSystemAdminConfirmBody', {
                name: removing.name ?? formatPhoneForDisplay(removing.phone!),
              })
            : t('systemAdmin.removeSystemAdminConfirmBodyUnnamed')
        }
        confirmLabel={t('systemAdmin.removeAdmin')}
        cancelLabel={t('systemAdmin.cancel')}
        destructive
      />
    </div>
  )
}
