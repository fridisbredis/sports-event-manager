import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { verifyStandardWebhook } from './standard-webhook'

const KEY = Buffer.from('a-test-signing-key-of-some-length')
const SECRET = `v1,whsec_${KEY.toString('base64')}`
const NOW = 1_800_000_000
const BODY = '{"user":{"id":"x"},"sms":{"otp":"123456"}}'

function sign(id: string, timestamp: string, body: string, key: Buffer = KEY) {
  return createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
}

function headers(overrides: Partial<Record<'id' | 'timestamp' | 'signature', string | null>> = {}) {
  const id = 'msg_1'
  const timestamp = String(NOW)
  return {
    id,
    timestamp,
    signature: `v1,${sign(id, timestamp, BODY)}`,
    ...overrides,
  }
}

describe('verifyStandardWebhook', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyStandardWebhook(SECRET, headers(), BODY, NOW)).toBe(true)
  })

  it('accepts the secret without its v1,whsec_ prefix', () => {
    expect(verifyStandardWebhook(KEY.toString('base64'), headers(), BODY, NOW)).toBe(true)
  })

  // Rotation: GoTrue may send several signatures, space-separated.
  it('accepts when any one of several signatures matches', () => {
    const signature = `v1,${sign('msg_1', String(NOW), BODY, Buffer.from('old'))} ${headers().signature}`
    expect(verifyStandardWebhook(SECRET, headers({ signature }), BODY, NOW)).toBe(true)
  })

  it('rejects a tampered body', () => {
    expect(verifyStandardWebhook(SECRET, headers(), BODY.replace('123456', '000000'), NOW)).toBe(
      false
    )
  })

  it('rejects a signature made with another key', () => {
    const signature = `v1,${sign('msg_1', String(NOW), BODY, Buffer.from('attacker'))}`
    expect(verifyStandardWebhook(SECRET, headers({ signature }), BODY, NOW)).toBe(false)
  })

  it('rejects a replay outside the five-minute window', () => {
    const timestamp = String(NOW - 301)
    const signature = `v1,${sign('msg_1', timestamp, BODY)}`
    expect(verifyStandardWebhook(SECRET, headers({ timestamp, signature }), BODY, NOW)).toBe(false)
  })

  it('rejects missing headers', () => {
    expect(verifyStandardWebhook(SECRET, headers({ id: null }), BODY, NOW)).toBe(false)
    expect(verifyStandardWebhook(SECRET, headers({ timestamp: null }), BODY, NOW)).toBe(false)
    expect(verifyStandardWebhook(SECRET, headers({ signature: null }), BODY, NOW)).toBe(false)
  })

  it('rejects an unknown signature version', () => {
    const signature = headers().signature!.replace(/^v1,/, 'v2,')
    expect(verifyStandardWebhook(SECRET, headers({ signature }), BODY, NOW)).toBe(false)
  })

  it('rejects an empty secret', () => {
    expect(verifyStandardWebhook('v1,whsec_', headers(), BODY, NOW)).toBe(false)
  })
})
