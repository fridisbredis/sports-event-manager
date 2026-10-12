import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Every loading.tsx under (official) is a server component. Importing from
// the '@heroui/react' barrel pulls in a provider chain that calls
// createContext, which throws at request time on the server — and neither
// `tsc` nor `next build` catches it, because it is a runtime failure in a
// file that compiles perfectly well. It surfaced only as a dev-overlay error
// on the live page.
//
// Asserted against the source text rather than by rendering: the failure is
// in module evaluation under the React server condition, which the jsdom test
// environment does not reproduce — a render here would pass while the real
// page threw.
const OFFICIAL_ROOT = join(__dirname, '..')

const loadingFiles = readdirSync(OFFICIAL_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ route: entry.name, path: join(OFFICIAL_ROOT, entry.name, 'loading.tsx') }))
  .filter(({ path }) => {
    try {
      readFileSync(path)
      return true
    } catch {
      return false
    }
  })

describe('(official) loading.tsx files', () => {
  // Guards the guard: if the discovery above silently matched nothing, every
  // assertion below would vacuously pass and the boundary would go unchecked.
  it('finds the loading files it means to check', () => {
    expect(loadingFiles.map((f) => f.route).sort()).toEqual([
      'account',
      'announcements',
      'availability',
      'event-info',
      'home',
      'schedule',
    ])
  })

  it.each(loadingFiles)('$route does not import the HeroUI barrel', ({ path }) => {
    expect(readFileSync(path, 'utf-8')).not.toMatch(/from ['"]@heroui\//)
  })

  it.each(loadingFiles)('$route stays a server component', ({ path }) => {
    expect(readFileSync(path, 'utf-8')).not.toMatch(/^['"]use client['"]/m)
  })
})

// The client boundary those files depend on. Whichever file imports the
// HeroUI barrel has to carry the directive; today that is the shared
// SkeletonRows, and the per-tab wrappers only pass it props.
describe('skeleton-rows.tsx', () => {
  it("declares 'use client', since it imports the HeroUI barrel", () => {
    const source = readFileSync(join(__dirname, 'skeleton-rows.tsx'), 'utf-8')
    expect(source).toMatch(/^['"]use client['"]/m)
  })
})
