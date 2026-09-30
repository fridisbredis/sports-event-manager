import { describe, expect, it } from 'vitest'
import {
  WORK_AREA_COLORS,
  workAreaBorderColor,
  workAreaColor,
  firstFreeWorkAreaColor,
  workAreaColorByName,
  workAreaColorMap,
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
  // identical at avatar size. The delivered palette's tightest pair is
  // periwinkle/iris at 0.0113; the threshold sits just under that, so a future
  // edit cannot quietly push any pair closer than today's worst.
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
    expect(closest.distance, `closest pair was ${closest.pair}`).toBeGreaterThanOrEqual(0.0112)
  })

  // Separation has to hold for every colour, not just on average: one colour
  // that sits close to two others is exactly the "these look the same" case,
  // even when the palette-wide minimum looks fine.
  it('gives every colour at least two clearly distinct neighbours', () => {
    for (const color of WORK_AREA_COLORS) {
      const distances = WORK_AREA_COLORS.filter((other) => other !== color)
        .map((other) => perceptualDistance(color.bg, other.bg))
        .sort((a, b) => a - b)
      expect(distances[1], `${color.name} has two near-identical neighbours`).toBeGreaterThan(0.02)
    }
  })

  // The picker renders the palette in array order as three rows of ten, so
  // the order is part of the delivered design, not an implementation detail.
  it('keeps the delivered palette order', () => {
    expect(WORK_AREA_COLORS.map((c) => c.bg)).toEqual([
      '#F7B8B8',
      '#F7C9A8',
      '#F6DDA0',
      '#EFE7A8',
      '#DCEBA0',
      '#C3E6A8',
      '#AEE0B4',
      '#A6E0C4',
      '#A0DED3',
      '#9DDAE0',
      '#9CCDE6',
      '#A3C1EC',
      '#B3BDEF',
      '#C4B4EC',
      '#D3B0E6',
      '#E0AEDD',
      '#E8AECB',
      '#EDACB8',
      '#E9B3A3',
      '#E0BE9B',
      '#D9C08C',
      '#D6CC8C',
      '#CBD394',
      '#BAD79C',
      '#A9D9AE',
      '#9CD6C0',
      '#9BD1D2',
      '#A0C6E3',
      '#B4BEE8',
      '#C9B8E3',
    ])
  })

  // The fg draws labels inside a filled schedule cell, so AA is not optional
  // here. The previous palette carried three exceptions; this one has none,
  // and this test is what stops one creeping back in.
  it('clears WCAG AA 4.5:1 for every pair', () => {
    for (const color of WORK_AREA_COLORS) {
      expect(contrastRatio(color.bg, color.fg), color.name).toBeGreaterThanOrEqual(4.5)
    }
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

describe('workAreaColorMap', () => {
  // The bug this function exists for. These are the real Testklubben ids from
  // dev: Social Media and Ringa both hashed to `teal2`, and Depån and
  // "Toalett och dusch" both to `magenta`, so a seven-row table showed two
  // pairs of identical dots.
  const TESTKLUBBEN = [
    '1a80659f-f12b-4480-89e9-5d96b24d74aa', // Social Media
    '4406e933-a172-4490-a88d-c3397aa7f5c7', // Skaffa toaletter
    '3d588d3c-e640-4c36-ac16-316d0f47e843', // Ringa
    '1562e56f-7906-420a-ba09-f28dfc47ba66', // Tidtagning
    'c6dec134-1110-48a4-91cf-f1950ce337e5', // Depån
    '66594b9f-a94b-45da-8228-d676d0419a32', // Toalett och dusch
    '10cf806a-e0b2-47d2-8204-ddd1b4d0d574', // On break
  ]

  it('gives the colliding Testklubben work areas distinct colors', () => {
    const map = workAreaColorMap(TESTKLUBBEN)
    const names = TESTKLUBBEN.map((id) => map.get(id)!.name)
    expect(new Set(names).size).toBe(TESTKLUBBEN.length)
  })

  it('assigns a distinct color to every id, up to the palette size', () => {
    for (const size of [2, 7, 15, 30]) {
      const ids = Array.from({ length: size }, (_, i) => `work-area-${i}-of-${size}`)
      const map = workAreaColorMap(ids)
      const names = ids.map((id) => map.get(id)!.name)
      expect(new Set(names).size, `${size} ids should get ${size} colors`).toBe(size)
    }
  })

  it('is independent of the order ids are passed in', () => {
    const ids = TESTKLUBBEN
    const forward = workAreaColorMap(ids)
    const reversed = workAreaColorMap([...ids].reverse())
    const shuffled = workAreaColorMap([ids[3], ids[0], ids[6], ids[1], ids[5], ids[2], ids[4]])
    for (const id of ids) {
      expect(reversed.get(id)).toEqual(forward.get(id))
      expect(shuffled.get(id)).toEqual(forward.get(id))
    }
  })

  it('keeps an uncontended id on the color it hashes to', () => {
    // A single id has nothing to contend with, so it must match the per-id
    // function exactly — that is what keeps colors stable as a list grows.
    for (let i = 0; i < 50; i++) {
      const id = `lonely-${i}`
      expect(workAreaColorMap([id]).get(id)).toEqual(workAreaColor(id))
    }
  })

  it('does not repaint unrelated work areas when one is added', () => {
    const existing = TESTKLUBBEN.slice(0, 5)
    const before = workAreaColorMap(existing)
    const after = workAreaColorMap([...existing, 'a-brand-new-work-area-id'])
    // Ids that were not sharing a color keep it. Ones that were may move, and
    // that is the point of the function.
    const moved = existing.filter((id) => before.get(id)!.name !== after.get(id)!.name)
    expect(moved).toEqual([])
  })

  it('handles duplicate ids without consuming extra colors', () => {
    const map = workAreaColorMap(['a', 'b', 'a', 'b', 'a'])
    expect(map.size).toBe(2)
    expect(map.get('a')).not.toEqual(map.get('b'))
  })

  it('wraps around rather than failing past the palette size', () => {
    const ids = Array.from({ length: 45 }, (_, i) => `overflow-${i}`)
    const map = workAreaColorMap(ids)
    expect(map.size).toBe(45)
    for (const id of ids) {
      expect(WORK_AREA_COLORS).toContain(map.get(id))
    }
    // All 30 colors get used before any repeats.
    expect(new Set(ids.map((id) => map.get(id)!.name)).size).toBe(30)
  })

  it('returns an empty map for an empty list', () => {
    expect(workAreaColorMap([]).size).toBe(0)
  })
})

describe('firstFreeWorkAreaColor', () => {
  it('returns the first colour when nothing is taken', () => {
    expect(firstFreeWorkAreaColor([])).toEqual(WORK_AREA_COLORS[0])
  })

  it('skips taken colours in palette order', () => {
    const taken = WORK_AREA_COLORS.slice(0, 3).map((c) => c.name)
    expect(firstFreeWorkAreaColor(taken)).toEqual(WORK_AREA_COLORS[3])
  })

  it('fills a gap rather than continuing past it', () => {
    // Deleting a work area frees its colour; the next one added should reuse
    // it instead of pushing further down a palette that is filling up.
    const taken = WORK_AREA_COLORS.filter((_, i) => i !== 2)
      .slice(0, 5)
      .map((c) => c.name)
    expect(firstFreeWorkAreaColor(taken)).toEqual(WORK_AREA_COLORS[2])
  })

  it('falls back to the first colour once all thirty are taken', () => {
    const taken = WORK_AREA_COLORS.map((c) => c.name)
    expect(firstFreeWorkAreaColor(taken)).toEqual(WORK_AREA_COLORS[0])
  })

  it('ignores names that are not in the palette', () => {
    // A colour retired from the palette can still sit in a row; it must not
    // consume a slot that no longer corresponds to it.
    expect(firstFreeWorkAreaColor(['teal2', 'magenta'])).toEqual(WORK_AREA_COLORS[0])
  })
})

describe('workAreaColorByName', () => {
  it('resolves every palette name', () => {
    for (const color of WORK_AREA_COLORS) {
      expect(workAreaColorByName(color.name)).toEqual(color)
    }
  })

  it('returns undefined for an unknown, empty or absent name', () => {
    // A name retired from the palette leaves rows behind holding it, so the
    // lookup has to fail softly rather than throw — callers fall back to the
    // hash. The `teal2`/`magenta` names came from the previous palette.
    expect(workAreaColorByName('teal2')).toBeUndefined()
    expect(workAreaColorByName('')).toBeUndefined()
    expect(workAreaColorByName(null)).toBeUndefined()
    expect(workAreaColorByName(undefined)).toBeUndefined()
  })
})

describe('workAreaColorMap with stored colors', () => {
  it('gives an id the color stored for it', () => {
    const map = workAreaColorMap([{ id: 'ws-1', color: 'orchid' }])
    expect(map.get('ws-1')!.name).toBe('orchid')
  })

  it('never displaces a stored color to resolve a hash collision', () => {
    // The admin chose it; a hashed id must move instead. Every unstored id in
    // the palette is thrown at one stored slot to prove nothing dislodges it.
    const ids = [
      { id: 'chosen', color: 'blush' },
      ...Array.from({ length: 29 }, (_, i) => ({ id: `hashed-${i}` })),
    ]
    const map = workAreaColorMap(ids)
    expect(map.get('chosen')!.name).toBe('blush')
    const others = ids.slice(1).map((entry) => map.get(entry.id)!.name)
    expect(others).not.toContain('blush')
  })

  it('lets two work areas share a stored color rather than reassigning one', () => {
    // The picker marks a taken color but does not forbid it, so two rows
    // holding the same one must both render it — silently repainting one
    // would contradict what the admin sees in the picker.
    const map = workAreaColorMap([
      { id: 'ws-1', color: 'sage' },
      { id: 'ws-2', color: 'sage' },
    ])
    expect(map.get('ws-1')!.name).toBe('sage')
    expect(map.get('ws-2')!.name).toBe('sage')
  })

  it('falls back to the hash for a null, absent or retired color', () => {
    for (const color of [null, undefined, 'teal2']) {
      const map = workAreaColorMap([{ id: 'ws-1', color }])
      expect(map.get('ws-1')).toEqual(workAreaColor('ws-1'))
    }
  })

  it('mixes stored and unstored ids without either losing its color', () => {
    const map = workAreaColorMap([
      { id: 'ws-1', color: 'iris' },
      { id: 'ws-2' },
      'ws-3',
      { id: 'ws-4', color: 'mint' },
    ])
    expect(map.size).toBe(4)
    expect(map.get('ws-1')!.name).toBe('iris')
    expect(map.get('ws-4')!.name).toBe('mint')
    expect(new Set([...map.values()].map((c) => c.name)).size).toBe(4)
  })

  it('keeps a stored color when the same id also appears bare', () => {
    // Callers build these lists from whatever they render, which can repeat an
    // id — the stored color must win regardless of which form came first.
    expect(workAreaColorMap([{ id: 'ws-1', color: 'clay' }, 'ws-1']).get('ws-1')!.name).toBe('clay')
    expect(workAreaColorMap(['ws-1', { id: 'ws-1', color: 'clay' }]).get('ws-1')!.name).toBe('clay')
  })

  it('stays independent of the order ids are passed in', () => {
    const entries = [
      { id: 'ws-1', color: 'blush' },
      { id: 'ws-2' },
      { id: 'ws-3', color: 'teal' },
      { id: 'ws-4' },
      { id: 'ws-5' },
    ]
    const forward = workAreaColorMap(entries)
    const reversed = workAreaColorMap([...entries].reverse())
    for (const entry of entries) {
      expect(reversed.get(entry.id)).toEqual(forward.get(entry.id))
    }
  })
})
