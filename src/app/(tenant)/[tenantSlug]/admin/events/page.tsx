import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ tenantSlug: string }>
}

// /admin/events without an id: the admin index picks the event.
export default async function AdminEventsIndexPage({ params }: Props) {
  const { tenantSlug } = await params
  redirect(`/${tenantSlug}/admin`)
}
