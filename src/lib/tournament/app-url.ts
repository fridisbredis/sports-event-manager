import { hasFeature } from '@/lib/tiers/features'

/**
 * The tournament app's address (ADR-0005 §7), from TOURNAMENT_APP_URL at
 * runtime — not a NEXT_PUBLIC_ variable, so it is read on the server and
 * handed to the browser as a prop, and needs no rebuild. Null when unset or
 * not a plain origin-style URL, which turns the Tournaments tab off.
 */
export function tournamentAppUrl(): string | null {
  const raw = process.env.TOURNAMENT_APP_URL?.trim()
  if (!raw) return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    // The origin is what both sides compare; a path or trailing slash would
    // only make the /viadal address wrong.
    return url.origin
  } catch {
    return null
  }
}

/**
 * Whether the official surfaces offer tournaments to this caller: a roster row
 * (an admin without one gets no token, ADR-0005 §5.3), a tier with
 * tournaments, and the app configured.
 */
export function offersTournaments(tenant: { tier: string; officialId: string | null }): boolean {
  return (
    tenant.officialId != null &&
    hasFeature(tenant.tier, 'tournaments') &&
    tournamentAppUrl() !== null
  )
}
