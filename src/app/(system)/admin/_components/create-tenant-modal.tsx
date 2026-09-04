'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { Button } from '@/components/ui/button'
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
      classNames={{ base: 'bg-gray-50' }}
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
          <Button variant="light" onPress={onClose}>
            {t('systemAdmin.cancel')}
          </Button>
          <Button
            color="primary"
            isDisabled={!name.trim()}
            isLoading={pending}
            onPress={handleSubmit}
          >
            {t('systemAdmin.create')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
