// Client side of admin_guide_dismissals (migration 20261123120310): hide
// (PUT) or show again (DELETE) the dashboard onboarding guide for one event.
// Resolves to whether the save went through; never throws, so callers can put
// the UI back instead of pretending.

const ENDPOINT = '/api/account/onboarding-guide'

export async function saveAdminGuideDismissal(
  method: 'PUT' | 'DELETE',
  eventId: string
): Promise<boolean> {
  try {
    const response = await fetch(ENDPOINT, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    })
    return response.ok
  } catch {
    return false
  }
}
