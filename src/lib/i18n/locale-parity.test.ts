import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * What this guards: a string added to one locale and forgotten in the other.
 *
 * `fallbackLng` is 'en' on purpose, so a missing Swedish key renders English
 * rather than a raw key — which is the right behaviour at runtime and exactly
 * what makes the gap invisible in review. Full parity has been the rule since
 * #215; this is what enforces it.
 */
const LOCALES_DIR = join(process.cwd(), 'public/locales')

function keysOf(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix]
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k)
  )
}

function load(locale: string, file: string): unknown {
  return JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), 'utf8'))
}

const locales = readdirSync(LOCALES_DIR).filter((d) => !d.startsWith('.'))
const [reference, ...others] = locales

describe('locale parity', () => {
  it('ships more than one locale, or this guard is meaningless', () => {
    expect(others.length).toBeGreaterThan(0)
  })

  for (const locale of others) {
    describe(`${locale} against ${reference}`, () => {
      const files = readdirSync(join(LOCALES_DIR, reference)).filter((f) => f.endsWith('.json'))

      for (const file of files) {
        it(`${file} has every key, and no extra ones`, () => {
          const expected = keysOf(load(reference, file)).sort()
          const actual = keysOf(load(locale, file)).sort()

          expect({
            missing: expected.filter((k) => !actual.includes(k)),
            unexpected: actual.filter((k) => !expected.includes(k)),
          }).toEqual({ missing: [], unexpected: [] })
        })
      }
    })
  }
})
