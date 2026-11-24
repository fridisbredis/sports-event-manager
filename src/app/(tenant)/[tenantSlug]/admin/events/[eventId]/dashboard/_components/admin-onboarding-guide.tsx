'use client'

import { useEffect, useState } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import { saveAdminGuideDismissal } from '@/lib/onboarding/save-admin-guide-dismissal'
import {
  OnboardingGlossary,
  OnboardingGuideCard,
  OnboardingGuideLayout,
  type OnboardingGuideProgress,
} from '../../_components/onboarding-guide'

interface Props extends OnboardingGuideProgress {
  tenantSlug: string
  eventId: string
  /** Whether this user has hidden the guide for this event (admin_guide_dismissals). */
  initiallyDismissed: boolean
}

// The dashboard's copy of the onboarding guide, which an admin can hide.
// Hiding affects this dashboard only (B22): Help and guide is its own page
// and always shows the guide, whatever is chosen here.

// Before the choice moved onto the user (migration 20261123120310) it lived
// in localStorage under this key. Read once to carry an existing choice over,
// then removed. Safe to delete together with the carry-over effect once the
// admins who hid the guide before the move have opened their dashboards.
const legacyStorageKey = (eventId: string) => `admin-onboarding-dismissed:${eventId}`

function readLegacyDismissal(eventId: string): boolean {
  try {
    return window.localStorage.getItem(legacyStorageKey(eventId)) === 'true'
  } catch {
    // Storage can throw in private windows or with site data blocked.
    return false
  }
}

function clearLegacyDismissal(eventId: string) {
  try {
    window.localStorage.removeItem(legacyStorageKey(eventId))
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function AdminOnboardingGuide({
  tenantSlug,
  eventId,
  initiallyDismissed,
  ...progress
}: Props) {
  const { t } = useTranslation('admin')
  // Seeded from the server and then owned here, so hiding is instant and a
  // later server re-render (router.refresh elsewhere) does not flip it back
  // while a save is in flight.
  const [isDismissed, setIsDismissed] = useState(initiallyDismissed)
  const [saveFailed, setSaveFailed] = useState(false)

  // One-time carry-over of a choice made while it lived in localStorage.
  useEffect(() => {
    if (initiallyDismissed || !readLegacyDismissal(eventId)) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from an external store (localStorage) that is only readable after mount
    setIsDismissed(true)
    void saveAdminGuideDismissal('PUT', eventId).then((ok) => {
      if (ok) clearLegacyDismissal(eventId)
    })
  }, [eventId, initiallyDismissed])

  async function dismiss() {
    setSaveFailed(false)
    setIsDismissed(true)
    if (!(await saveAdminGuideDismissal('PUT', eventId))) {
      // Put the guide back rather than pretend: a hide that was not saved
      // would silently undo itself on the next visit.
      setIsDismissed(false)
      setSaveFailed(true)
    }
  }

  if (isDismissed) return null

  return (
    <OnboardingGuideLayout>
      <OnboardingGuideCard
        tenantSlug={tenantSlug}
        eventId={eventId}
        progress={progress}
        footer={
          <>
            <button
              type="button"
              onClick={() => void dismiss()}
              className="rounded-control border border-edge-field bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-gray-50"
            >
              {t('dashboard.onboardingGuide.dismiss')}
            </button>
            {saveFailed && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {t('dashboard.onboardingGuide.dismissFailed')}
              </p>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              {t('dashboard.onboardingGuide.dismissNote')}
            </p>
          </>
        }
      />
      <OnboardingGlossary />
    </OnboardingGuideLayout>
  )
}
