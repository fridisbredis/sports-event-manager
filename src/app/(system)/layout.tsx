import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getUserRoles } from '@/lib/auth/tenant'

interface Props {
  children: React.ReactNode
}

export default async function SystemLayout({ children }: Props) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const roles = await getUserRoles(user.id)
  const isSystemAdmin = roles.some((r) => r.role === 'system_admin')
  if (!isSystemAdmin) notFound()

  return <>{children}</>
}
