import { importJWK, type CryptoKey, type JWK } from 'jose'

// ADR-0005 §6.1: Viadal signs the tournament engine's tokens with ES256. The
// private keys live only here, as private JWKs (JSON, with kid) in two env
// vars; the engine fetches the public halves from /.well-known/jwks.json.
// Server-only by construction: the env vars have no NEXT_PUBLIC_ prefix, so
// Next never inlines them into a browser bundle.
//
// Rotation: put the new key in TOURNAMENT_SIGNING_KEY_NEXT and deploy, so the
// JWKS publishes it before anything is signed with it. Once the engine has
// refreshed its JWKS, move it to _CURRENT (and the old one out) and deploy
// again. Tokens live 15 minutes, so the old key can go a little after that.
//
// scripts/generate-tournament-key.mjs prints a key in this format.

export const SIGNING_ALG = 'ES256'

const ENV_CURRENT = 'TOURNAMENT_SIGNING_KEY_CURRENT'
const ENV_NEXT = 'TOURNAMENT_SIGNING_KEY_NEXT'

type PrivateJwk = JWK & { kid: string; d: string }

/** Parses one env var; null when unset, throws when set but not a usable ES256 private JWK. */
function readPrivateJwk(name: string): PrivateJwk | null {
  const raw = process.env[name]
  if (!raw) return null

  let jwk: unknown
  try {
    jwk = JSON.parse(raw)
  } catch {
    // Never include the value: it is the private key.
    throw new Error(`${name} is not valid JSON`)
  }
  if (
    typeof jwk !== 'object' ||
    jwk === null ||
    (jwk as JWK).kty !== 'EC' ||
    (jwk as JWK).crv !== 'P-256' ||
    typeof (jwk as JWK).kid !== 'string' ||
    !(jwk as JWK).kid ||
    typeof (jwk as JWK).d !== 'string'
  ) {
    throw new Error(`${name} must be a P-256 private JWK with a kid`)
  }
  return jwk as PrivateJwk
}

/** The public half: everything but the private scalar, marked for ES256 signatures. */
function toPublicJwk({ kty, crv, x, y, kid }: PrivateJwk): JWK {
  return { kty, crv, x, y, kid, alg: SIGNING_ALG, use: 'sig' }
}

/**
 * The public keys to publish: the current one and, during a rotation, the
 * next. Empty when no key is configured, so the JWKS still answers and the
 * engine simply finds nothing to trust.
 */
export function publicJwks(): { keys: JWK[] } {
  const keys = [readPrivateJwk(ENV_CURRENT), readPrivateJwk(ENV_NEXT)]
    .filter((jwk): jwk is PrivateJwk => jwk !== null)
    .map(toPublicJwk)
  return { keys }
}

/** The key tokens are signed with, or null when none is configured (the token route then fails closed). */
export async function currentSigningKey(): Promise<{ key: CryptoKey; kid: string } | null> {
  const jwk = readPrivateJwk(ENV_CURRENT)
  if (!jwk) return null
  const key = await importJWK(jwk, SIGNING_ALG)
  return { key: key as CryptoKey, kid: jwk.kid }
}
