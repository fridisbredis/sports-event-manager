'use client'

import { useState } from 'react'
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
  /** Whether this user has hidden the guide on the dashboard for this event. */
  hiddenOnDashboard: boolean
}

// Help and guide (B22): the guide and glossary, always shown. Opening it does
// not touch the dashboard's hide choice; if the guide is hidden there, this is
// where it can be brought back.
export function HelpGuide({ tenantSlug, eventId, hiddenOnDashboard, ...progress }: Props) {
  const { t } = useTranslation('admin')
  const [hidden, setHidden] = useState(hiddenOnDashboard)
  const [restored, setRestored] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  async function showOnDashboard() {
    setSaving(true)
    setSaveFailed(false)
    const ok = await saveAdminGuideDismissal('DELETE', eventId)
    setSaving(false)
    if (ok) {
      setHidden(false)
      setRestored(true)
    } else {
      setSaveFailed(true)
    }
  }

  const footer = hidden ? (
    <>
      <p className="mb-3 text-sm text-ink-muted">{t('help.hiddenOnDashboard')}</p>
      <button
        type="button"
        onClick={() => void showOnDashboard()}
        disabled={saving}
        className="rounded-control border border-edge-field bg-white px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-gray-50 disabled:opacity-60"
      >
        {t('help.showOnDashboard')}
      </button>
      {saveFailed && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t('help.showOnDashboardFailed')}
        </p>
      )}
    </>
  ) : restored ? (
    <p role="status" className="text-sm text-ink-muted">
      {t('help.shownOnDashboard')}
    </p>
  ) : undefined

  return (
    <OnboardingGuideLayout>
      <OnboardingGuideCard
        tenantSlug={tenantSlug}
        eventId={eventId}
        progress={progress}
        footer={footer}
      />
      <OnboardingGlossary />
    </OnboardingGuideLayout>
  )
}
