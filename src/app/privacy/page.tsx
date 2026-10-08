import Link from 'next/link'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'

export const metadata = {
  title: 'Privacy policy — Sports Event Manager',
}

// Reached signed out as often as signed in: it is linked from sign-in and from
// the invite forms, both of which run before an account exists. So it resolves
// the language itself rather than inheriting one from a tenant layout, and
// renders no tenant theme — nothing here belongs to a single organization.
export default async function PrivacyPage() {
  const language = await getUserLanguage()
  const t = await getServerTranslation(language)

  // Each block is a question someone actually arrives with, rather than a
  // heading lifted from the legal text. Kept as data so the draft notice and
  // the final copy can swap without touching the layout.
  const sections = [
    { key: 'data', heading: t('privacyPage.dataHeading'), body: t('privacyPage.dataBody') },
    {
      key: 'purpose',
      heading: t('privacyPage.purposeHeading'),
      body: t('privacyPage.purposeBody'),
    },
    {
      key: 'retention',
      heading: t('privacyPage.retentionHeading'),
      body: t('privacyPage.retentionBody'),
    },
  ]

  return (
    <main className="mx-auto w-full max-w-prose px-6 pb-20 pt-16">
      <h1 className="page-title">{t('privacyPage.title')}</h1>

      {/* The draft state is the first thing to say, not a footnote: someone
          reading this to decide whether to hand over a phone number should
          know up front that it is not the final text. */}
      <div className="mt-6 rounded-card border-1 border-status-pending-text/20 bg-status-pending-bg/60 px-5 py-4">
        <p className="text-xs font-bold uppercase tracking-label-wide text-status-pending-text">
          {t('privacyPage.draftBadge')}
        </p>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          {t('privacyPage.draftBody')}
        </p>
      </div>

      <h2 className="section-label mt-12">{t('privacyPage.summaryHeading')}</h2>

      {/* A description list, not a stack of divs: these are literally
          term-and-explanation pairs, and the semantics are what lets a screen
          reader announce "What we store" as the label for the text under it. */}
      <dl className="mt-5 space-y-8">
        {sections.map((section) => (
          <div key={section.key}>
            <dt className="text-[17px] font-bold tracking-tight text-ink">{section.heading}</dt>
            <dd className="mt-1.5 text-[15px] leading-relaxed text-ink-muted">{section.body}</dd>
          </div>
        ))}
      </dl>

      {/* Most arrivals come from the sign-in page or an invite form, mid-task.
          The way back matters more than it would on a page reached from a nav. */}
      <div className="mt-14 border-t border-edge-soft pt-6">
        <Link
          href="/login"
          className="rounded-md text-[15px] font-semibold text-ink-soft underline decoration-edge decoration-1 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
        >
          {t('privacyPage.backToSignIn')}
        </Link>
      </div>
    </main>
  )
}
