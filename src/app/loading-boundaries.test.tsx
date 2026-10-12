import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Every loading.tsx is a server component. Importing from the '@heroui/react'
// barrel pulls in a provider chain that calls createContext, which throws at
// request time on the server — and neither `tsc` nor `next build` catches it,
// because it is a runtime failure in a file that compiles perfectly well. It
// surfaced only as a dev-overlay error on the live page.
//
// Asserted against the source text rather than by rendering: the failure is
// in module evaluation under the React server condition, which the jsdom test
// environment does not reproduce — a render here would pass while the real
// page threw.
//
// Discovered by walking src/app rather than listing routes, so a loading.tsx
// added to a new route is covered without anyone remembering to add it here.
const APP_ROOT = __dirname

function findLoadingFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      found.push(...findLoadingFiles(full))
    } else if (entry.name === 'loading.tsx') {
      found.push(full)
    }
  }
  return found
}

const loadingFiles = findLoadingFiles(APP_ROOT).map((path) => ({
  route: relative(APP_ROOT, path),
  path,
}))

describe('loading.tsx boundaries', () => {
  // Guards the guard: if the walk above silently matched nothing, every
  // assertion below would vacuously pass and the boundary would go unchecked.
  it('finds the loading files it means to check', () => {
    expect(loadingFiles.length).toBeGreaterThanOrEqual(15)
  })

  it.each(loadingFiles)('$route does not import the HeroUI barrel', ({ path }) => {
    expect(readFileSync(path, 'utf-8')).not.toMatch(/from ['"]@heroui\//)
  })

  it.each(loadingFiles)('$route stays a server component', ({ path }) => {
    expect(readFileSync(path, 'utf-8')).not.toMatch(/^['"]use client['"]/m)
  })
})

// The client boundaries those files depend on. Whichever file imports the
// HeroUI barrel has to carry the directive; the loading files only pass props
// to these.
describe('skeleton client boundaries', () => {
  it.each([
    '(official)/[tenantSlug]/_components/skeleton-rows.tsx',
    '(tenant)/[tenantSlug]/admin/_components/admin-skeleton.tsx',
  ])("%s declares 'use client'", (relPath) => {
    const source = readFileSync(join(APP_ROOT, relPath), 'utf-8')
    expect(source).toMatch(/^['"]use client['"]/m)
  })
})
