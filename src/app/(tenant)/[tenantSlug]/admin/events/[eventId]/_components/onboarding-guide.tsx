'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Check, LockKeyhole } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'
import { useTranslation } from '@/lib/i18n/client'
import { adminEventPath } from '@/lib/events/paths'
import {
  getAdminGuideSteps,
  type AdminGuideStepId,
  type AdminGuideStepStatus,
} from '@/lib/onboarding/admin-guide-progress'

// The onboarding guide and its glossary, shared by the dashboard (EVT-01),
// where an admin can hide them, and Help and guide (B22), where they always
// show. Neither card knows about hiding: the dashboard passes its hide button
// in as `footer`, Help and guide passes its own.

export interface OnboardingGuideProgress {
  eventConfigComplete: boolean
  workAreaCount: number
  confirmedOfficialCount: number
  assignedShiftCount: number
  isPublished: boolean
  tierAllowsPublish: boolean
}

const STEP_IDS: AdminGuideStepId[] = [
  'eventConfig',
  'workAreas',
  'officials',
  'scheduling',
  'publishing',
]

const GLOSSARY_TERMS = [
  'stage',
  'raceStage',
  'granularity',
  'workArea',
  'official',
  'published',
] as const

const STATUS_CLASSES: Record<AdminGuideStepStatus, string> = {
  complete: 'bg-status-ok-bg text-status-ok-text',
  current: 'bg-tenant-accent-tint text-tenant-accent-tint-text',
  upcoming: 'bg-status-neutral-bg text-status-neutral-text',
  locked: 'bg-status-neutral-bg text-status-neutral-text',
}

/** Guide card and glossary side by side on wide screens, stacked on a phone. */
export function OnboardingGuideLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
      {children}
    </div>
  )
}

export function OnboardingGuideCard({
  tenantSlug,
  eventId,
  progress: {
    eventConfigComplete,
    workAreaCount,
    confirmedOfficialCount,
    assignedShiftCount,
    isPublished,
    tierAllowsPublish,
  },
  footer,
}: {
  tenantSlug: string
  eventId: string
  progress: OnboardingGuideProgress
  footer?: ReactNode
}) {
  const { t } = useTranslation('admin')

  const { steps, completedCount } = getAdminGuideSteps({
    eventConfigComplete,
    workAreaCount,
    confirmedOfficialCount,
    assignedShiftCount,
    isPublished,
  })

  const percent = Math.round((completedCount / STEP_IDS.length) * 100)
  const links: Record<AdminGuideStepId, string> = {
    eventConfig: adminEventPath(tenantSlug, eventId, 'event'),
    workAreas: adminEventPath(tenantSlug, eventId, 'workstations'),
    officials: adminEventPath(tenantSlug, eventId, 'officials'),
    scheduling: adminEventPath(tenantSlug, eventId, 'scheduling'),
    // A full path, not a bare #publish-status: the card also renders on Help
    // and guide, which has no publish section of its own.
    publishing: adminEventPath(tenantSlug, eventId, 'dashboard#publish-status'),
  }
  const actions: Record<AdminGuideStepId, string> = {
    eventConfig: t('dashboard.onboardingGuide.edit'),
    workAreas: t('dashboard.onboardingGuide.addWorkArea'),
    officials: t('dashboard.onboardingGuide.inviteOfficials'),
    scheduling: t('dashboard.onboardingGuide.openScheduling'),
    publishing: t('dashboard.onboardingGuide.publishEvent'),
  }

  return (
    <section aria-labelledby="onboarding-guide-title">
      <p className="section-label mb-3">{t('dashboard.onboardingGuide.sectionLabel')}</p>
      <AppCard className="card-accent-primary" bodyClassName="p-5 md:p-6">
        <div className="mb-5">
          <h2 id="onboarding-guide-title" className="text-xl font-bold text-ink">
            {t('dashboard.onboardingGuide.title')}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
            {t('dashboard.onboardingGuide.intro')}
          </p>
        </div>

        <div className="mb-4 flex items-center justify-between gap-3 text-sm">
          <span className="font-semibold text-ink">
            {t('dashboard.onboardingGuide.progress', {
              completed: completedCount,
              total: STEP_IDS.length,
            })}
          </span>
          <span className="text-ink-muted">{percent}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={t('dashboard.onboardingGuide.progressLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mb-5 h-2.5 overflow-hidden rounded-full bg-gray-200"
        >
          <div
            className="h-full rounded-full bg-tenant-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>

        <ol className="divide-y divide-edge-soft">
          {steps.map(({ id, status }, index) => (
            <li key={id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-start">
              <StepMarker status={status} number={index + 1} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">
                    {t(`dashboard.onboardingGuide.steps.${id}.title`)}
                  </h3>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[status]}`}
                  >
                    {t(`dashboard.onboardingGuide.status.${status}`)}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                  {t(`dashboard.onboardingGuide.steps.${id}.description`)}
                </p>
                {status === 'locked' && (
                  <p className="mt-1.5 text-sm text-ink-muted">
                    {t('dashboard.onboardingGuide.schedulingLocked')}
                  </p>
                )}
              </div>
              <StepAction
                id={id}
                status={status}
                href={links[id]}
                label={actions[id]}
                tierAllowsPublish={tierAllowsPublish}
                premiumLabel={t('dashboard.premiumBadge')}
                lockedLabel={t('dashboard.onboardingGuide.status.locked')}
              />
            </li>
          ))}
        </ol>

        {footer && <div className="mt-5 border-t border-edge pt-5">{footer}</div>}
      </AppCard>
    </section>
  )
}

export function OnboardingGlossary() {
  const { t } = useTranslation('admin')

  return (
    <section id="onboarding-glossary" aria-labelledby="onboarding-glossary-title">
      <p className="section-label mb-3">{t('dashboard.onboardingGuide.glossaryLabel')}</p>
      <AppCard className="card-accent-primary" bodyClassName="p-5 md:p-6">
        <h2 id="onboarding-glossary-title" className="sr-only">
          {t('dashboard.onboardingGuide.glossaryLabel')}
        </h2>
        <dl className="space-y-3">
          {GLOSSARY_TERMS.map((term) => (
            <div key={term}>
              <dt className="font-semibold text-ink">
                {t(`dashboard.onboardingGuide.glossary.${term}.term`)}
              </dt>
              <dd className="mt-0.5 text-sm leading-relaxed text-ink-soft">
                {t(`dashboard.onboardingGuide.glossary.${term}.description`)}
              </dd>
            </div>
          ))}
        </dl>
      </AppCard>
    </section>
  )
}

function StepMarker({ status, number }: { status: AdminGuideStepStatus; number: number }) {
  if (status === 'complete') {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-tenant-primary text-white">
        <Check className="size-5" aria-hidden="true" />
      </span>
    )
  }

  if (status === 'locked') {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-status-neutral-bg text-status-neutral-text">
        <LockKeyhole className="size-4" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span
      className={`flex size-10 shrink-0 items-center justify-center rounded-full border-2 text-sm font-semibold ${
        status === 'current'
          ? 'border-tenant-primary text-tenant-primary'
          : 'border-edge-field text-ink-muted'
      }`}
    >
      {number}
    </span>
  )
}

function StepAction({
  id,
  status,
  href,
  label,
  tierAllowsPublish,
  premiumLabel,
  lockedLabel,
}: {
  id: AdminGuideStepId
  status: AdminGuideStepStatus
  href: string
  label: string
  tierAllowsPublish: boolean
  premiumLabel: string
  lockedLabel: string
}) {
  if (status === 'complete') return null

  if (status === 'locked') {
    return (
      <span className="hidden shrink-0 self-center text-sm text-ink-faint sm:block">
        {lockedLabel}
      </span>
    )
  }

  if (id === 'publishing' && !tierAllowsPublish) {
    return (
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-2 self-start rounded-control border border-edge-field bg-white px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-gray-50 sm:self-center"
      >
        {label}
        <span className="rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-text">
          {premiumLabel}
        </span>
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className={`inline-flex shrink-0 self-start rounded-control px-3 py-2 text-sm font-semibold transition-colors sm:self-center ${
        status === 'current'
          ? 'bg-tenant-primary text-white hover:bg-tenant-primary-hover'
          : 'border border-edge-field bg-white text-tenant-primary-tint-text hover:bg-gray-50'
      }`}
    >
      {label}
    </Link>
  )
}
