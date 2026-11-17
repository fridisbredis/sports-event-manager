import { NextResponse } from 'next/server'
import { publicJwks } from '@/lib/tournament/keys'
import { logger } from '@/lib/logger'

// ADR-0005 §6.1: the public keys the tournament engine validates Viadal's
// tournament tokens with. Public by design (src/proxy.ts lets this exact path
// through without a session) and holds no secrets: only the public halves of
// the signing keys, see src/lib/tournament/keys.ts.
//
// force-dynamic like /api/health/live: the keys are runtime env vars on the
// Container App, not present at build time, so a response prerendered by the
// build would publish no keys at all.
export const dynamic = 'force-dynamic'

export async function GET() {
  let jwks
  try {
    jwks = publicJwks()
  } catch (err) {
    // A malformed key is a deploy mistake. Fail loudly rather than publish a
    // partial set the engine would quietly trust.
    logger.error('JWKS unavailable: a tournament signing key is misconfigured', err)
    return NextResponse.json({ error: 'Keys unavailable' }, { status: 500 })
  }

  return NextResponse.json(jwks, {
    headers: {
      // Short enough that a rotation reaches the engine within minutes, long
      // enough that the engine's fetches stay cheap.
      'Cache-Control': 'public, max-age=300',
    },
  })
}
