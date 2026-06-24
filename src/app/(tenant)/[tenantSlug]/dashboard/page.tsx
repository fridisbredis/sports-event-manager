import { createSupabaseServerClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

interface Props {
  params: { tenantSlug: string }
}

export default async function DashboardPage({ params }: Props) {
  const supabase = await createSupabaseServerClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('*')
    .eq('slug', params.tenantSlug)
    .single()

  if (!tenant) notFound()

  return (
    <main>
      <h1>{tenant.name}</h1>
      {/* TODO: dashboard content */}
    </main>
  )
}
