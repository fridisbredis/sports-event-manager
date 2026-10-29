'use client'

import { useEffect, useState } from 'react'
import { Switch } from '@heroui/react'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import {
  disablePush,
  enablePush,
  getPushSupport,
  isPushEnabledHere,
  type PushSupport,
} from '@/lib/push/client'

interface Props {
  vapidPublicKey: string
}

// N31: per-device opt-in for push notifications, shown under the SMS toggle.
// Push is sent in addition to SMS, so turning this off never affects the SMS
// above it — the hints say so, because that is the first question a user has.
//
// Whether push works is a property of the browser, which the server cannot
// see, so the row renders a neutral state until it has mounted and checked.
export function PushToggle({ vapidPublicKey }: Props) {
  const { t } = useTranslation('official')
  const [support, setSupport] = useState<PushSupport | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Must run after mount, not during a lazy useState initializer: navigator
    // and Notification don't exist during SSR, so reading them there would
    // make the client's hydration render disagree with the server HTML.
    const detected = getPushSupport()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupport(detected)
    if (detected !== 'supported') return
    setBlocked(Notification.permission === 'denied')
    void isPushEnabledHere().then(setEnabled)
  }, [])

  // Nothing until mounted, so server and first client render agree. After
  // that every state renders a row, unsupported included: an official on an
  // old browser should learn why push is unavailable rather than see nothing.
  if (support === null) return null

  function handleChange(isSelected: boolean) {
    // enablePush() is called synchronously from the event handler — iOS only
    // shows the permission prompt for a user gesture, and an await in front of
    // the call would lose it.
    setBusy(true)
    const work = isSelected
      ? enablePush(vapidPublicKey).then((result) => {
          if (result === 'enabled') {
            setEnabled(true)
          } else if (result === 'denied') {
            setBlocked(Notification.permission === 'denied')
            toastError(t('account.pushDenied'))
          } else {
            toastError(t('account.pushEnableFailed'))
          }
        })
      : disablePush()
          .then(() => setEnabled(false))
          .catch(() => toastError(t('account.pushDisableFailed')))
    void work.finally(() => setBusy(false))
  }

  let hint: string
  if (support === 'needs-install') hint = t('account.pushHintInstallIos')
  else if (support === 'unsupported') hint = t('account.pushHintUnsupported')
  else if (blocked) hint = t('account.pushHintBlocked')
  else hint = enabled ? t('account.pushHintOn') : t('account.pushHintOff')

  return (
    <div className="mt-4 flex items-center justify-between gap-4 border-t border-edge-soft pt-4">
      <div>
        <p className="text-[15px] font-semibold text-ink">{t('account.pushLabel')}</p>
        <p className="mt-0.5 text-sm text-ink-muted">{hint}</p>
      </div>
      {support === 'supported' && (
        <Switch
          isSelected={enabled}
          isDisabled={busy || blocked}
          onValueChange={handleChange}
          color="primary"
          aria-label={t('account.pushLabel')}
        />
      )}
    </div>
  )
}
