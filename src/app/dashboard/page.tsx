import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserRoles, resolvePostLoginRedirect } from '@/lib/auth/tenant'

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const roles = await getUserRoles(user.id)
  const destination = resolvePostLoginRedirect(roles)

  redirect(destination ?? '/')
}
