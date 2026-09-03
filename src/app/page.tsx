import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import {
  getUserRoles,
  resolvePostLoginRedirect,
  hasPendingOfficialInviteByPhone,
} from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'
import { formatPhoneForDisplay } from '@/lib/phone'
import { LogoutButton } from '@/components/logout-button'

export default async function RootPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const roles = await getUserRoles(user.id)
  const destination = resolvePostLoginRedirect(roles)

  if (destination) redirect(destination)

  // No roles yet — check if this is an official completing their invite via
  // the phone-fallback path (no invite link visited). SEC-09: consent must be
  // shown before confirmOfficialInvite is called, so route to the
  // interstitial instead of confirming here directly.
  if (user.phone && (await hasPendingOfficialInviteByPhone(user.phone))) {
    redirect('/confirm-invite')
  }

  const t = await getServerTranslation('en')
  return (
    <main className="max-w-md mx-auto mt-20 p-6">
      <h1 className="text-xl font-semibold">{t('errors.notAuthorized')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('errors.noAccess')}</p>
      {/* Deliberately no "signed in" wording: the user has no access, so
          telling them they have a session is confusing and leaks more than
          it helps. The digits are the useful part. */}
      {user.phone && (
        <p className="mt-4 text-sm text-gray-500">
          {t('errors.numberUsed', { phone: formatPhoneForDisplay(user.phone) })}
        </p>
      )}
      {/* Same shared logout control the admin sidebars use. This gives up the
          no-JS form fallback, but the sidebars already require JS, so it's
          consistent. */}
      <LogoutButton className="mt-6 text-sm text-blue-600 hover:underline">
        {t('errors.tryDifferentNumber')}
      </LogoutButton>
    </main>
  )
}
