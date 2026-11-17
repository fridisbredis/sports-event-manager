#!/usr/bin/env node
// ADR-0005 §6.1: creates an ES256 key pair for signing the tournament engine's
// tokens, in the format src/lib/tournament/keys.ts reads.
//
//   node scripts/generate-tournament-key.mjs <env>        # env: dev, prod or local
//
// stdout: the PRIVATE JWK as one line of JSON, with kid. It goes straight into
// TOURNAMENT_SIGNING_KEY_CURRENT (or _NEXT during a rotation) and 1Password,
// for example:
//
//   node scripts/generate-tournament-key.mjs dev | gh secret set TOURNAMENT_SIGNING_KEY_CURRENT
//
// stderr: the kid and the public JWK, safe to read and share.
//
// One key per environment; never reuse prod's key anywhere else.
import { exportJWK, generateKeyPair } from 'jose'

const env = process.argv[2]
if (!['dev', 'prod', 'local'].includes(env)) {
  console.error('Usage: node scripts/generate-tournament-key.mjs <dev|prod|local>')
  process.exit(1)
}

const { privateKey } = await generateKeyPair('ES256', { extractable: true })
const jwk = await exportJWK(privateKey)
// Date plus a random suffix: readable in the engine's logs, and two keys made
// on the same day (a retry) still differ.
const kid = `viadal-${env}-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`
const privateJwk = { ...jwk, kid, alg: 'ES256', use: 'sig' }

process.stdout.write(JSON.stringify(privateJwk) + '\n')

const { d: _private, ...publicJwk } = privateJwk
console.error(`kid: ${kid}`)
console.error(`public JWK: ${JSON.stringify(publicJwk)}`)
console.error('stdout holds the PRIVATE key: pipe it into a secret, do not paste it anywhere else.')
