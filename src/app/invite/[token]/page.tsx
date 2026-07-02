import { createSupabaseServiceClient } from '@/lib/supabase/server'
import InviteForm from './_components/invite-form'

interface Props {
  params: Promise<{ token: string }>
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params
  const service = await createSupabaseServiceClient()

  const { data: official } = await service
    .from('officials')
    .select('phone, name, invite_status, invite_token_expires_at')
    .eq('invite_token', token)
    .maybeSingle()

  const isValid =
    official &&
    official.invite_status === 'invited' &&
    official.invite_token_expires_at !== null &&
    new Date(official.invite_token_expires_at) > new Date()

  return (
    <InviteForm
      token={token}
      phone={isValid ? official.phone : null}
      name={isValid ? official.name : null}
    />
  )
}
