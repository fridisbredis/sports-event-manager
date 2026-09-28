import { describe, expect, it } from 'vitest'
import {
  WORK_AREA_COLORS,
  workAreaBorderColor,
  workAreaColor,
  workAreaDotColor,
} from './work-area-colors'

// sRGB -> OKLab. Perceptual distance in this space is what decides whether two
// pastels actually look different; hue angle alone does not (the eye resolves
// greens far more coarsely than reds or blues).
function toOklab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))
  const r = lin(((n >> 16) & 255) / 255)
  const g = lin(((n >> 8) & 255) / 255)
  const b = lin((n & 255) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function perceptualDistance(a: string, b: string): number {
  const [l1, a1, b1] = toOklab(a)
  const [l2, a2, b2] = toOklab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}

function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('WORK_AREA_COLORS', () => {
  it('has exactly 30 colors', () => {
    expect(WORK_AREA_COLORS).toHaveLength(30)
  })

  it('has unique names and unique background/foreground pairs', () => {
    expect(new Set(WORK_AREA_COLORS.map((c) => c.name)).size).toBe(30)
    expect(new Set(WORK_AREA_COLORS.map((c) => `${c.bg}/${c.fg}`)).size).toBe(30)
  })

  it('uses 6-digit uppercase hex throughout', () => {
    for (const { bg, fg } of WORK_AREA_COLORS) {
      expect(bg).toMatch(/^#[0-9A-F]{6}$/)
      expect(fg).toMatch(/^#[0-9A-F]{6}$/)
    }
  })

  // Guards the property the palette exists for: that two work areas or two
  // officials sitting next to each other are actually distinguishable. An
  // earlier revision spaced hues evenly around the circle, which clustered
  // eight of the thirty into green/teal with pairs 0.005 apart — visually
  // identical at avatar size. Anything under ~0.01 is too close to call.
  it('keeps every pair of backgrounds perceptually distinguishable', () => {
    let closest = { distance: Infinity, pair: '' }
    for (let i = 0; i < WORK_AREA_COLORS.length; i++) {
      for (let j = i + 1; j < WORK_AREA_COLORS.length; j++) {
        const distance = perceptualDistance(WORK_AREA_COLORS[i].bg, WORK_AREA_COLORS[j].bg)
        if (distance < closest.distance) {
          closest = {
            distance,
            pair: `${WORK_AREA_COLORS[i].name}/${WORK_AREA_COLORS[j].name}`,
          }
        }
      }
    }
    expect(closest.distance, `closest pair was ${closest.pair}`).toBeGreaterThan(0.01)
  })

  // Separation has to hold for every colour, not just on average: one colour
  // that sits close to two others is exactly the "these look the same" case,
  // even when the palette-wide minimum looks fine.
  it('gives every colour at least two clearly distinct neighbours', () => {
    for (const color of WORK_AREA_COLORS) {
      const distances = WORK_AREA_COLORS.filter((other) => other !== color)
        .map((other) => perceptualDistance(color.bg, other.bg))
        .sort((a, b) => a - b)
      expect(distances[1], `${color.name} has two near-identical neighbours`).toBeGreaterThan(0.012)
    }
  })

  it('opens with the eight pairs from the design handoff, in order', () => {
    expect(WORK_AREA_COLORS.slice(0, 8)).toEqual([
      { name: 'blue', bg: '#DCEAFE', fg: '#1D4ED8' },
      { name: 'violet', bg: '#E5DFFC', fg: '#7C3AED' },
      { name: 'teal', bg: '#D3F5E7', fg: '#0F766E' },
      { name: 'rose', bg: '#FCE1E4', fg: '#BE123C' },
      { name: 'amber', bg: '#FCEFD1', fg: '#B45309' },
      { name: 'fuchsia', bg: '#F7E1FA', fg: '#A21CAF' },
      { name: 'green', bg: '#DCF5E1', fg: '#15803D' },
      { name: 'indigo', bg: '#DEE3FC', fg: '#4338CA' },
    ])
  })

  // The three sub-4.5:1 pairs are the handoff's own and are kept deliberately;
  // this test pins that decision so a future edit has to be explicit about it.
  it('holds every generated pair to 4.5:1, and the handoff pairs to 4.3:1', () => {
    const belowAA: string[] = []
    for (const color of WORK_AREA_COLORS) {
      const ratio = contrastRatio(color.bg, color.fg)
      expect(ratio).toBeGreaterThanOrEqual(4.3)
      if (ratio < 4.5) belowAA.push(color.name)
    }
    expect(belowAA).toEqual(['violet', 'amber', 'green'])
  })
})

describe('workAreaColor', () => {
  it('is deterministic for the same id', () => {
    const id = '3f2b8c1e-0a44-4f7a-9b21-6d5e8c0a1f33'
    expect(workAreaColor(id)).toBe(workAreaColor(id))
  })

  it('always returns a member of the palette', () => {
    for (let i = 0; i < 500; i++) {
      expect(WORK_AREA_COLORS).toContain(workAreaColor(`work-area-${i}`))
    }
  })

  it('spreads ids across the whole palette rather than clustering', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      seen.add(workAreaColor(`${i}-4f7a-9b21-6d5e8c0a1f33`).name)
    }
    // A hash that collapsed onto a few buckets is the failure this guards.
    expect(seen.size).toBe(30)
  })

  it('handles an empty id without throwing', () => {
    expect(WORK_AREA_COLORS).toContain(workAreaColor(''))
  })
})

describe('decorative derivations', () => {
  it('mixes dots to 65% and borders to 35% of the foreground', () => {
    const color = WORK_AREA_COLORS[0]
    expect(workAreaDotColor(color)).toBe(`color-mix(in srgb, ${color.fg} 65%, white)`)
    expect(workAreaBorderColor(color)).toBe(`color-mix(in srgb, ${color.fg} 35%, white)`)
  })
})
