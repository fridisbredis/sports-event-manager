'use client'

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import { Button } from '@/components/ui/button'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
  destructive?: boolean
}

export default function ConfirmDialog({
  open,
  title,
  body,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  destructive = false,
}: ConfirmDialogProps) {
  return (
    <Modal
      isOpen={open}
      onOpenChange={(isOpen) => !isOpen && onCancel()}
      size="sm"
      classNames={{ base: 'bg-gray-50' }}
    >
      <ModalContent>
        <ModalHeader className="text-sm">{title}</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-500 leading-relaxed">{body}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            color={destructive ? 'danger' : 'primary'}
            onPress={onConfirm}
            // The handoff's destructive button is #BE123C; HeroUI's danger
            // scale is a pinker #F31260.
            className={
              destructive
                ? 'bg-destructive-solid hover:bg-destructive-hover data-[hover=true]:opacity-100'
                : undefined
            }
          >
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
