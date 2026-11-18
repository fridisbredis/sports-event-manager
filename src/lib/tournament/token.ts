import { SignJWT } from 'jose'
import type { TenantPalette } from '@/lib/theme/tenant-colors'
import { SIGNING_ALG, currentSigningKey } from './keys'

// ADR-0005 §6.1: the token an official takes to the tournament engine. The
// engine trusts it because it verifies against /.well-known/jwks.json, and it
// limits the official to one event (ctx) of one tenant.

/** The engine checks this exact value. */
export const TOURNAMENT_AUDIENCE = 'tournament-engine'

const TOKEN_LIFETIME_SECONDS = 15 * 60

export type TournamentTokenSubject = {
  officialId: string
  /** officials.name, shown in the engine's trees and lists. */
  name: string
  eventId: string
  tenantId: string
  tier: string
  /**
   * The official's Viadal language (user_preferences, the default when they
   * never chose one), so the tournament app speaks the same language (N55).
   */
  locale: string
  /**
   * The colour values of the tenant's palette (TENANT_PALETTES), so the
   * tournament app's /viadal pages wear the tenant's colours (N52). The values
   * rather than the palette's name: the table then lives only here, and a new
   * palette needs no change in the app.
   */
  palette: TenantPalette
}

export type TournamentToken = { token: string; expiresAt: string }

/**
 * Signs a token for one official in one event, or returns null when this
 * environment has no signing key or issuer configured (the caller then fails
 * closed). The issuer is per environment (TOURNAMENT_TOKEN_ISSUER), and the
 * engine's configuration for that environment must name the same value.
 */
export async function signTournamentToken(
  subject: TournamentTokenSubject,
  now: Date = new Date()
): Promise<TournamentToken | null> {
  const issuer = process.env.TOURNAMENT_TOKEN_ISSUER
  const signing = await currentSigningKey()
  if (!issuer || !signing) return null

  const issuedAt = Math.floor(now.getTime() / 1000)
  const expiresAt = issuedAt + TOKEN_LIFETIME_SECONDS

  const token = await new SignJWT({
    name: subject.name,
    ctx: `viadal:event:${subject.eventId}`,
    tenant: subject.tenantId,
    tier: subject.tier,
    locale: subject.locale,
    palette: subject.palette,
  })
    .setProtectedHeader({ alg: SIGNING_ALG, kid: signing.kid, typ: 'JWT' })
    .setIssuer(issuer)
    .setAudience(TOURNAMENT_AUDIENCE)
    .setSubject(`viadal:official:${subject.officialId}`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(signing.key)

  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() }
}
