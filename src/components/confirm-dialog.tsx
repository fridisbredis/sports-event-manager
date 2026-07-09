'use client'

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Button } from '@heroui/react'

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
    <Modal isOpen={open} onOpenChange={(isOpen) => !isOpen && onCancel()} size="sm">
      <ModalContent>
        <ModalHeader className="text-sm">{title}</ModalHeader>
        <ModalBody>
          <p className="text-sm text-default-500 leading-relaxed">{body}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onCancel}>
            {cancelLabel}
          </Button>
          <Button color={destructive ? 'danger' : 'primary'} onPress={onConfirm}>
            {confirmLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
