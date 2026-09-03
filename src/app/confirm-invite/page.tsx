import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { hasPendingOfficialInviteByPhone } from '@/lib/auth/tenant'
import ConfirmInviteForm from './_components/confirm-invite-form'

// SEC-09 consent interstitial for the phone-fallback invite path. Only
// reachable via the redirect in src/app/page.tsx, but re-checks for a
// pending invite itself rather than trusting the referrer — a user who
// navigates here directly, or whose invite was confirmed/revoked between
// the redirect and this render, should not see a stale consent form.
export default async function ConfirmInvitePage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!user.phone || !(await hasPendingOfficialInviteByPhone(user.phone))) {
    redirect('/')
  }

  return <ConfirmInviteForm />
}
