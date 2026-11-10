'use client'

import { useState } from 'react'
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react'
import QRCode from 'qrcode'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { toastError, toastSuccess } from '@/lib/toast'
import { logger } from '@/lib/logger'

interface Props {
  /** `/claim/<claim_token>` — the origin is added in the browser. */
  claimPath: string
  /** File name stem for the downloaded QR image. */
  eventName: string
}

// PB6: the admin can copy the claim link and show a QR code in every state,
// draft included, so a QR code can be printed before the event opens. The
// link never changes (events.claim_token), so what is printed keeps working.
//
// The origin comes from the page the admin is on rather than from
// NEXT_PUBLIC_APP_URL: the admin and the public claim page are served by the
// same app, and this also gives a working link on localhost, where
// buildAppLink refuses anything that is not https.
//
// The QR code is drawn in the browser by the qrcode package. No third-party
// QR service ever sees the link.
export function ClaimLinkActions({ claimPath, eventName }: Props) {
  const { t } = useTranslation('admin')
  const [qrOpen, setQrOpen] = useState(false)
  const [claimUrl, setClaimUrl] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  // Read at click time: window does not exist during the server render.
  const currentUrl = () => `${window.location.origin}${claimPath}`

  async function openQr() {
    const url = currentUrl()
    setClaimUrl(url)
    setQrOpen(true)
    try {
      // 1024 px with a quiet zone: sharp enough to print on an A4 poster.
      setQrDataUrl(
        await QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' })
      )
    } catch (err) {
      logger.error('Claim QR code generation failed', err)
      toastError(t('participants.claimLink.qrError'))
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(currentUrl())
      toastSuccess(t('participants.claimLink.copied'))
    } catch (err) {
      // Clipboard access is refused on plain http and in some embedded
      // browsers. The modal shows the link as selectable text for that case.
      logger.warn('Copying the claim link failed', { err: String(err) })
      toastError(t('participants.claimLink.copyError'))
      await openQr()
    }
  }

  const downloadName = `${eventName.trim().replace(/[^\p{L}\p{N}]+/gu, '-') || 'event'}-claim-qr.png`

  function downloadQr() {
    if (!qrDataUrl) return
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = downloadName
    a.click()
  }

  return (
    <>
      <Button variant="bordered" onPress={copyLink}>
        {t('participants.claimLink.copy')}
      </Button>
      <Button variant="bordered" onPress={openQr}>
        {t('participants.claimLink.showQr')}
      </Button>

      <Modal
        isOpen={qrOpen}
        onOpenChange={setQrOpen}
        size="md"
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
          <ModalHeader>{t('participants.claimLink.qrTitle')}</ModalHeader>
          <ModalBody>
            <div className="mx-auto flex size-56 items-center justify-center rounded-xl border border-edge bg-white p-2">
              {qrDataUrl ? (
                // A data URL generated above — next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={t('participants.claimLink.qrAlt')}
                  className="size-full"
                />
              ) : null}
            </div>
            <Input
              aria-label={t('participants.claimLink.linkLabel')}
              value={claimUrl ?? ''}
              isReadOnly
              onFocus={(e) => (e.target as HTMLInputElement).select()}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="bordered" onPress={copyLink}>
              {t('participants.claimLink.copyShort')}
            </Button>
            <Button color="primary" onPress={downloadQr} isDisabled={!qrDataUrl}>
              {t('participants.claimLink.download')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
