'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { Button } from '@/components/ui/button'
import { SystemButton } from './system-button'
import { Input } from '@/components/ui/form-fields'
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
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slug = toSlug(name)

  async function handleSubmit() {
    if (!name.trim() || pending) return
    setPending(true)
    setError(null)
    const result = await createTenant(name)
    setPending(false)
    if (result.error) {
      setError(result.error)
      toastError(result.error)
    } else {
      setName('')
      onClose()
    }
  }

  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && onClose()}
      // White card on the handoff's backdrop, with its modal radius and
      // shadow. The grey base this carried before made the dialog read as a
      // panel of the page behind it rather than as a sheet above it.
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
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" className="rounded-control border-edge" onPress={onClose}>
            {t('systemAdmin.cancel')}
          </Button>
          <SystemButton isDisabled={!name.trim()} isLoading={pending} onPress={handleSubmit}>
            {t('systemAdmin.create')}
          </SystemButton>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
