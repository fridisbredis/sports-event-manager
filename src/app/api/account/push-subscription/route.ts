import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logQueryError } from '@/lib/db/query-error'

// N31: registers or removes this device's Web Push subscription.
//
// Not tenant-scoped, for the same reason as /api/account/language: a device
// belongs to a person, and which tenant's announcement reaches it is decided
// at send time through officials.user_id.
//
// Runs on the RLS client, not service_role (SEC-03): the table's policies
// already say "a user manages exactly their own rows", so the database
// enforces ownership and this handler only has to authenticate.

// The browser's PushSubscription.toJSON() shape. Endpoints are https URLs at
// the push service; the keys are base64url. Bounded so a hostile client cannot
// store arbitrarily large strings.
const subscribeSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .url()
    .refine((value) => value.startsWith('https://')),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(256),
  }),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().max(2048),
})

async function requireUser(op: string) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()

  // Same split as /api/account/language: an expired session is the ordinary
  // route to 401 and is not logged, a GoTrue 5xx is.
  if (error && error.status !== undefined && error.status >= 500) {
    logQueryError(error, { op, table: 'auth.users', kind: 'select' })
  }

  return { supabase, user: data.user }
}

export async function PUT(request: NextRequest) {
  const op = 'PUT /api/account/push-subscription'
  const { supabase, user } = await requireUser(op)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = subscribeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  // Upsert on endpoint: re-enabling on the same device returns the same
  // endpoint, so this refreshes the keys rather than adding a second row.
  // If the endpoint is still held by ANOTHER user's row, RLS hides that row
  // and the upsert is refused — the client avoids that by always replacing
  // the browser subscription before registering (see src/lib/push/client.ts).
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: request.headers.get('user-agent')?.slice(0, 512) ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' }
  )

  if (error) {
    logQueryError(error, { op, table: 'push_subscriptions', kind: 'update' })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const op = 'DELETE /api/account/push-subscription'
  const { supabase, user } = await requireUser(op)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // The user_id filter is redundant with RLS and kept on purpose (defense in
  // depth): a policy regression must not turn this into "delete anyone's
  // device by endpoint".
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', parsed.data.endpoint)

  if (error) {
    logQueryError(error, { op, table: 'push_subscriptions', kind: 'delete' })
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
