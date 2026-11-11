/**
 * B14 — verifies a Supabase Auth hook request (Standard Webhooks spec).
 *
 * GoTrue signs every HTTP hook call with the secret generated in the
 * dashboard ("v1,whsec_<base64>"). The signature is
 *   base64(HMAC-SHA256(secret, `${webhook-id}.${webhook-timestamp}.${body}`))
 * sent as `webhook-signature: v1,<sig>` (several space-separated entries are
 * allowed, so a secret can be rotated without downtime).
 *
 * Written out rather than pulled in as the `standardwebhooks` package: it is
 * thirty lines of node:crypto, and this is the one place it is needed.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

// The spec's recommended replay window. GoTrue sends the request the moment it
// signs it, so anything older than this is a replay, not clock skew.
const TOLERANCE_SECONDS = 5 * 60

export interface WebhookHeaders {
  id: string | null
  timestamp: string | null
  signature: string | null
}

function secretBytes(secret: string): Buffer | null {
  const raw = secret.replace(/^v1,/, '').replace(/^whsec_/, '')
  if (!raw) return null
  const bytes = Buffer.from(raw, 'base64')
  return bytes.length > 0 ? bytes : null
}

export function verifyStandardWebhook(
  secret: string,
  headers: WebhookHeaders,
  body: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): boolean {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false

  const key = secretBytes(secret)
  if (!key) return false

  if (!/^\d+$/.test(timestamp)) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()

  return signature.split(' ').some((entry) => {
    const [version, value] = entry.split(',', 2)
    if (version !== 'v1' || !value) return false
    const given = Buffer.from(value, 'base64')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
