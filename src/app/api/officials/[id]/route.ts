import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { requireTenantAdmin } from '@/lib/auth/tenant'
import { z } from 'zod'

const deleteSchema = z.object({
  tenantId: z.string().uuid(),
})

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tenantId = request.nextUrl.searchParams.get('tenantId')

  const parsed = deleteSchema.safeParse({ tenantId })
  if (!parsed.success) {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  const auth = await requireTenantAdmin(parsed.data.tenantId)
  if ('error' in auth) return auth.error

  const service = await createSupabaseServiceClient()

  const { data: official } = await service
    .from('officials')
    .select('id, tenant_id')
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)
    .single()

  if (!official) {
    return NextResponse.json({ error: 'Official not found' }, { status: 404 })
  }

  // Free any assignments this official holds
  await service.from('assignments').delete().eq('official_id', id).eq('tenant_id', parsed.data.tenantId)

  const { error } = await service
    .from('officials')
    .update({ invite_status: 'removed' })
    .eq('id', id)
    .eq('tenant_id', parsed.data.tenantId)

  if (error) {
    return NextResponse.json({ error: 'Failed to remove official' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
