'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { confirmOfficialInvite } from '@/lib/auth/tenant'

export interface ConfirmInviteByPhoneResult {
  error?: string
}

// SEC-09: the phone-fallback invite path (no /invite/[token] link visited)
// has no UI step between OTP login and the post-login redirect, so consent
// is collected here — on /confirm-invite, after page.tsx has already routed
// a phone-matched, role-less user to this interstitial — rather than inline
// in the token-flow's pre-OTP form.
export async function confirmInviteByPhone(
  privacyAccepted: boolean
): Promise<ConfirmInviteByPhoneResult> {
  if (!privacyAccepted) {
    return { error: 'privacy_not_accepted' }
  }

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')
  if (!user.phone) return { error: 'phone_mismatch' }

  const tenantSlug = await confirmOfficialInvite(user.id, user.phone, privacyAccepted)
  if (!tenantSlug) return { error: 'not_found' }

  redirect(`/${tenantSlug}/assignments`)
}
