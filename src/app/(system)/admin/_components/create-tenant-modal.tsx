'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, SelectItem } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { SystemButton } from './system-button'
import { Input, Select } from '@/components/ui/form-fields'
import { isValidPhoneForCountry, DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES } from '@/lib/phone'
import { createTenant } from '../actions'
import { toSlug } from '../_utils'
import { toastError } from '@/lib/toast'
import { useTranslation } from '@/lib/i18n/client'

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateTenantModal({ open, onClose }: Props) {
  const { t } = useTranslation('admin')
  const [name, setName] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminPhone, setAdminPhone] = useState('')
  const [adminPhoneCountry, setAdminPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slug = toSlug(name)
  const phoneIsValid =
    adminPhone.trim() !== '' && isValidPhoneForCountry(adminPhone, adminPhoneCountry)
  const canSubmit = name.trim() !== '' && adminName.trim() !== '' && phoneIsValid

  function reset() {
    setName('')
    setAdminName('')
    setAdminPhone('')
    setAdminPhoneCountry(DEFAULT_PHONE_COUNTRY)
    setError(null)
  }

  function handleClose() {
    if (pending) return
    reset()
    onClose()
  }

  async function handleSubmit() {
    if (!canSubmit || pending) return
    setPending(true)
    setError(null)
    const result = await createTenant(name, adminName.trim(), adminPhone.trim(), adminPhoneCountry)
    setPending(false)
    if (result.error) {
      setError(result.error)
      toastError(result.error)
    } else {
      reset()
      onClose()
    }
  }

  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && handleClose()}
      // White card on the handoff's backdrop, with its modal radius and
      // shadow. The grey base this carried before made the dialog read as a
      // panel of the page behind it rather than as a sheet above it.
      size="lg"
      classNames={{
        base: 'bg-white rounded-card shadow-modal',
        backdrop: 'bg-ink/45',
        header: 'px-6 pb-2 pt-6 font-display text-xl font-extrabold tracking-tight text-ink',
        body: 'px-6',
        footer: 'gap-3 px-6 pb-6 pt-4',
        closeButton: 'right-4 top-4 text-ink-label hover:bg-status-neutral-bg',
      }}
    >
      <ModalContent>
        <ModalHeader>{t('systemAdmin.createTenant')}</ModalHeader>
        <ModalBody>
          <Input
            label={t('systemAdmin.raceName')}
            placeholder={t('systemAdmin.raceName')}
            value={name}
            onValueChange={setName}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
            isInvalid={!!error}
            description={
              slug ? (
                <>
                  URL slug: <span className="font-mono">{slug}</span>
                </>
              ) : (
                t('systemAdmin.createTenantHint')
              )
            }
          />

          {/* The first admin. Required: a tenant created without one cannot be
              signed in to at all, which is how two of the three tenants in
              prod ended up unreachable. */}
          <div className="mt-2 border-t border-edge-soft pt-4">
            <h3 className="section-label mb-1">{t('systemAdmin.firstAdminSection')}</h3>
            <p className="mb-3 text-sm text-ink-label">{t('systemAdmin.firstAdminHint')}</p>
            <div className="flex flex-col gap-3">
              <Input
                label={t('systemAdmin.addAdminName')}
                placeholder={t('systemAdmin.addAdminNamePlaceholder')}
                value={adminName}
                onValueChange={(value) => {
                  setAdminName(value)
                  setError(null)
                }}
              />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  label={t('systemAdmin.addAdminCountry')}
                  className="w-full sm:w-52 sm:shrink-0"
                  selectedKeys={[adminPhoneCountry]}
                  onSelectionChange={(keys) => {
                    const next = Array.from(keys)[0] as string
                    setAdminPhoneCountry(next as typeof adminPhoneCountry)
                    setError(null)
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
                  value={adminPhone}
                  onValueChange={(value) => {
                    setAdminPhone(value)
                    setError(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                />
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="bordered"
            className="rounded-control border-edge"
            onPress={handleClose}
            isDisabled={pending}
          >
            {t('systemAdmin.cancel')}
          </Button>
          <SystemButton isDisabled={!canSubmit} isLoading={pending} onPress={handleSubmit}>
            {t('systemAdmin.create')}
          </SystemButton>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
