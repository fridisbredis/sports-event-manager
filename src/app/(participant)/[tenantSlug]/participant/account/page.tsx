import { redirect, notFound } from 'next/navigation'
import { getCurrentUser, getParticipantTenant, hasOfficialScreens } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fetchOwnIceContact } from '@/lib/ice-contact-read'
import { loadParticipantHome } from '@/lib/participants/participant-home'
import { ParticipantAccountForm } from './_components/participant-account-form'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// N43: ACCT-01, participant variant. Reachable whatever the state of the
// caller's events (PB3, PB10) — so, unlike PAR-01 and INFO-01, this page never
// asks isParticipantSideOpen.
export default async function ParticipantAccountPage({ params }: Props) {
  const { tenantSlug } = await params
  const language = await getUserLanguage()
  const t = await getServerTranslation(language, 'official')

  const user = await getCurrentUser()

  if (!user) redirect('/login')

  const tenant = await getParticipantTenant(tenantSlug)

  if (!tenant) notFound()

  const supabase = await createSupabaseServerClient()

  // Through the session: participant_read_own scopes this to the caller.
  const [{ data: records, error }, home, iceContact, isOfficial] = await Promise.all([
    supabase
      .from('participants')
      .select('name, phone, sms_opt_out')
      .in(
        'id',
        tenant.entries.map((e) => e.participantId)
      )
      .order('created_at', { ascending: true }),
    loadParticipantHome(tenant, { withAnnouncement: false }),
    fetchOwnIceContact(supabase, user.id, 'participant/account'),
    hasOfficialScreens(tenantSlug),
  ])

  if (error) throw error
  if (!records || records.length === 0) notFound()

  // One switch for the tenant, as for officials; set_own_participant_sms_opt_out
  // writes it to every record. Shown off only when every record is opted out,
  // so a mixed state (from before this screen existed) reads as "on" and one
  // tap makes it uniform.
  const smsOptOut = records.every((r) => r.sms_opt_out)

  return (
    <div>
      <div className="px-5 pt-10">
        <h1 className="page-title">{t('account.title')}</h1>
      </div>
      <ParticipantAccountForm
        tenantId={tenant.id}
        name={records[0].name ?? ''}
        phone={records.find((r) => r.phone)?.phone ?? user.phone ?? ''}
        smsOptOut={smsOptOut}
        iceContact={iceContact}
        myRace={home.events.map((e) => ({
          eventId: e.eventId,
          eventName: e.name,
          stageNames: e.stages.map((s) => s.name),
          bib: e.bib,
          category: e.category,
          raceResultsUrl: e.raceResultsUrl,
        }))}
        language={language}
        officialHref={isOfficial ? `/${tenantSlug}/events` : null}
      />
    </div>
  )
}
