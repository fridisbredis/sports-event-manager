'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, SelectItem } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { SystemButton } from '../../_components/system-button'
import { Input, Select } from '@/components/ui/form-fields'
import ConfirmDialog from '@/components/confirm-dialog'
import { toastError } from '@/lib/toast'
import { useTranslation } from '@/lib/i18n/client'
import { isValidPhoneForCountry, DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES } from '@/lib/phone'
import { grantTenantAdmin, revokeTenantAdmin } from '../../actions'
import type { TenantAdmin } from '@/lib/auth/tenant-admins'

interface Props {
  tenantId: string
  admins: TenantAdmin[]
  cap: number
  // Formatted server-side so the list matches the locale/time-format setting
  // the user chose, rather than the browser's (B7 — those are two separate
  // settings and dates follow the locale one).
  formattedDates: Record<string, string>
}

export function TenantAdminsSection({ tenantId, admins, cap, formattedDates }: Props) {
  const { t } = useTranslation('admin')
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY)
  const [pending, setPending] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<TenantAdmin | null>(null)
  const [removePending, setRemovePending] = useState(false)

  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)
  const canSubmit = name.trim() !== '' && phoneIsValid
  const atCap = admins.length >= cap
  // The last admin cannot be removed — the RPC refuses it too, but disabling
  // the button explains why before the click rather than after.
  const isLastAdmin = admins.length <= 1

  async function handleAdd() {
    if (!canSubmit || pending) return
    setPending(true)
    setAddError(null)
    const result = await grantTenantAdmin(tenantId, name.trim(), phone.trim(), phoneCountry)
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
    const result = await revokeTenantAdmin(tenantId, removing.userId)
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
      <div className="mb-1 flex items-center justify-between gap-4">
        <h2 className="section-label">{t('systemAdmin.tenantAdmins')}</h2>
        <span className="text-sm tabular-nums text-ink-label">
          {t('systemAdmin.adminsUsedOfCap', { count: admins.length, cap })}
        </span>
      </div>
      <p className="mb-4 text-sm text-ink-label">{t('systemAdmin.tenantAdminsHint')}</p>

      {admins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-6 text-center">
          <p className="text-sm font-semibold text-ink">{t('systemAdmin.noAdminsYet')}</p>
          <p className="mt-1 text-sm text-ink-label">{t('systemAdmin.noAdminsHint')}</p>
        </div>
      ) : (
        <ul className="divide-y divide-edge-soft">
          {admins.map((admin) => (
            <li key={admin.userId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {admin.name ?? (
                    <span className="font-normal italic text-ink-label">
                      {t('systemAdmin.adminUnknownName')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 truncate text-xs text-ink-label">
                  {admin.phone && admin.phone !== admin.name ? `${admin.phone} · ` : ''}
                  {t('systemAdmin.adminAddedOn', { date: formattedDates[admin.userId] ?? '' })}
                </p>
                {admin.lockedOut && (
                  <p className="mt-1 text-xs text-status-pending-text">
                    {t('systemAdmin.adminLockedOutHint')}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {admin.lockedOut && (
                  <span className="rounded-full bg-status-pending-bg px-2.5 py-1 text-xs font-semibold text-status-pending-text">
                    {t('systemAdmin.adminLockedOut')}
                  </span>
                )}
                <Button
                  variant="bordered"
                  size="sm"
                  onPress={() => setRemoving(admin)}
                  isDisabled={isLastAdmin}
                  // Destructive row action: the repo's `destructive` token
                  // rather than HeroUI's `color="danger"`, which tailwind.config
                  // deliberately leaves to HeroUI (see the NB there).
                  className="border-destructive text-destructive"
                  // Says why the button is dead instead of leaving a greyed-out
                  // control with no explanation — the RPC refuses this too.
                  title={isLastAdmin ? t('systemAdmin.lastAdminHint') : undefined}
                >
                  {t('systemAdmin.removeAdmin')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3">
        <SystemButton onPress={() => setAddOpen(true)} isDisabled={atCap}>
          {t('systemAdmin.addAdmin')}
        </SystemButton>
        {atCap && <span className="text-sm text-ink-label">{t('systemAdmin.capReachedHint')}</span>}
      </div>

      <Modal isOpen={addOpen} onOpenChange={closeAdd} size="lg">
        <ModalContent>
          <ModalHeader>{t('systemAdmin.addAdmin')}</ModalHeader>
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
            <p className="text-sm text-ink-label">{t('systemAdmin.addAdminHint')}</p>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeAdd} isDisabled={pending}>
              {t('systemAdmin.cancel')}
            </Button>
            <SystemButton onPress={handleAdd} isDisabled={!canSubmit} isLoading={pending}>
              {t('systemAdmin.addAdmin')}
            </SystemButton>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onConfirm={handleRemove}
        title={t('systemAdmin.removeAdminConfirmTitle')}
        // Names the person where there is a name to use, and falls back to the
        // phone number — an admin added before the name field existed has the
        // number as their name, and a roster row can be missing entirely, in
        // which case the unnamed wording avoids an empty "{{name}} loses...".
        body={
          removing?.name || removing?.phone
            ? t('systemAdmin.removeAdminConfirmBody', {
                name: removing.name ?? removing.phone,
              })
            : t('systemAdmin.removeAdminConfirmBodyUnnamed')
        }
        confirmLabel={t('systemAdmin.removeAdmin')}
        cancelLabel={t('systemAdmin.cancel')}
        destructive
      />
    </div>
  )
}
