'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button, Input } from '@heroui/react'
import { createTenant } from '../actions'
import { toSlug } from '../_utils'
import { toastError } from '@/lib/toast'

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateTenantModal({ open, onClose }: Props) {
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
    <Modal isOpen={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <ModalContent>
        <ModalHeader>Create tenant</ModalHeader>
        <ModalBody>
          <Input
            label="Race name"
            placeholder="Race name"
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
                'This provisions an empty event draft for the tenant.'
              )
            }
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button color="primary" isDisabled={!name.trim()} isLoading={pending} onPress={handleSubmit}>
            Create
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
