'use server'

import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { confirmOfficialInvite } from '@/lib/auth/tenant'
import { logQueryError } from '@/lib/db/query-error'

export interface ConfirmInviteByPhoneResult {
  error?: string
}

// SEC-09: the phone-fallback invite path (no /invite/[token] link visited)
// has no UI step between OTP login and the post-login redirect, so consent
// is collected here — on /confirm-invite, after page.tsx has already routed
// a phone-matched, role-less user to this interstitial — rather than inline
// in the token-flow's pre-OTP form.
export async function confirmInviteByPhone(
  tenantId: string,
  privacyAccepted: boolean
): Promise<ConfirmInviteByPhoneResult> {
  if (!privacyAccepted) {
    return { error: 'privacy_not_accepted' }
  }

  // Guards against an empty/missing selection reaching the RPC — the picker
  // UI is expected to always submit a real tenantId (auto-selected when
  // there is exactly one pending invite, chosen by the user when there are
  // several), so this is a defensive early return, not the primary guard.
  if (!tenantId) {
    return { error: 'not_found' }
  }

  const supabase = await createSupabaseServerClient()
  const { data, error: authError } = await supabase.auth.getUser()
  const user = data.user

  // An expired or missing session is the ordinary path to the /login redirect
  // below and is not logged — that is a stale session, not a defect. Anything
  // else (Auth unreachable, a 5xx from GoTrue) would otherwise be
  // indistinguishable from it, and the invitee just lands back on /login.
  if (authError && authError.status !== undefined && authError.status >= 500) {
    logQueryError(authError, {
      op: 'confirmInviteByPhone',
      table: 'auth.users',
      kind: 'select',
    })
  }

  if (!user) redirect('/login')
  if (!user.phone) return { error: 'phone_mismatch' }

  const tenantSlug = await confirmOfficialInvite(user.id, tenantId, user.phone, privacyAccepted)
  if (!tenantSlug) return { error: 'not_found' }

  redirect(`/${tenantSlug}/home`)
}
