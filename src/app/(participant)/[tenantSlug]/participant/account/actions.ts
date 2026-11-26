'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { getCurrentUser, getParticipantTenant } from '@/lib/auth/tenant'
import { logger } from '@/lib/logger'
import { translateDbError } from '@/lib/actions/db-error-message'
import { translateActionError as tError } from '@/lib/actions/action-error'
import { removeParticipantAvatar } from '@/lib/participants/participant-avatar'
import { adminEventRoutePattern, participantPath } from '@/lib/events/paths'

const eventIdSchema = z.string().uuid()

export interface LeaveEventResult {
  /** Already translated; safe to render. */
  error?: string
}

/**
 * N74: the signed-in participant leaves one event they are entered in.
 *
 * Takes the EVENT, not the participant record: the caller can only ever name
 * an event, and the record is looked up among their own entries. A record id
 * from the client would be one more thing to check; this way there is no
 * other record to name.
 *
 * TWO GATES. The entry must be among the caller's own (getParticipantTenant,
 * keyed on participants.user_id), and leave_own_participant_entry clears the
 * row only WHERE user_id = auth.uid(). Either one alone would hold; together
 * a bug in one is not a way into someone else's record.
 *
 * On success this redirects and does not return: back to participant Start if
 * the caller still has an entry in the tenant, otherwise to /dashboard, which
 * sends them to whatever surface they still have (or to the no-access page).
 */
export async function leaveParticipantEvent(input: {
  tenantSlug: string
  eventId: string
}): Promise<LeaveEventResult> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const eventId = eventIdSchema.safeParse(input.eventId)
  if (!eventId.success) return { error: await tError('actionErrors.invalidRequest') }

  const tenant = await getParticipantTenant(input.tenantSlug)
  if (!tenant) return { error: await tError('actionErrors.notAuthorized') }

  const entry = tenant.entries.find((e) => e.eventId === eventId.data)
  if (!entry) {
    logger.warn('leaveParticipantEvent: event is not among the caller’s entries', {
      tenantId: tenant.id,
      eventId: eventId.data,
    })
    return { error: await tError('actionErrors.participantEntryGone') }
  }

  // The caller's own session: the function is scoped by auth.uid().
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc('leave_own_participant_entry', {
    p_participant_id: entry.participantId,
  })

  if (error) {
    return {
      error: await translateDbError('leaveParticipantEvent: leave_own_participant_entry', error),
    }
  }

  // jsonb (F-REL-16); shape asserted in
  // tests/integration/participant-leave-event.test.ts.
  const result = (data ?? {}) as unknown as { left?: boolean; avatar_url?: string | null }

  // Left already in another tab, or unlinked by an admin a moment ago.
  if (!result.left) {
    logger.warn('leaveParticipantEvent: record no longer the caller’s', {
      tenantId: tenant.id,
      eventId: eventId.data,
    })
    return { error: await tError('actionErrors.participantEntryGone') }
  }

  await removeParticipantAvatar(
    createSupabaseServiceClient(),
    result.avatar_url ?? null,
    { tenantId: tenant.id, participantId: entry.participantId },
    'leaveParticipantEvent'
  )

  // The whole participant surface reads the caller's entries: home cards,
  // the Event info tab (B29 picker), Account. And the admin's participants
  // list, which now shows the row unclaimed.
  revalidatePath('/[tenantSlug]/participant', 'layout')
  revalidatePath(adminEventRoutePattern('participants'), 'page')

  const remaining = tenant.entries.length - 1
  redirect(remaining > 0 ? participantPath(input.tenantSlug) : '/dashboard')
}
