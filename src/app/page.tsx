import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserRoles, resolvePostLoginRedirect, confirmOfficialInvite } from '@/lib/auth/tenant'
import { getServerTranslation } from '@/lib/i18n/server'

export default async function RootPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const roles = await getUserRoles(user.id)
  const destination = resolvePostLoginRedirect(roles)

  if (destination) redirect(destination)

  // No roles yet — check if this is an official completing their invite
  if (user.phone) {
    const tenantSlug = await confirmOfficialInvite(user.id, user.phone)
    if (tenantSlug) redirect(`/${tenantSlug}/assignments`)
  }

  const t = await getServerTranslation('en')
  return (
    <main className="max-w-md mx-auto mt-20 p-6">
      <h1 className="text-xl font-semibold">{t('errors.notAuthorized')}</h1>
      <p className="mt-2 text-sm text-gray-600">{t('errors.noAccess')}</p>
    </main>
  )
}
