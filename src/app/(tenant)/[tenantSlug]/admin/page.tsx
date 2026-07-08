import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

export default async function AdminIndexPage({ params }: Props) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/admin/dashboard`)
}
