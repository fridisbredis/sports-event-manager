import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// loading.tsx is a server component. Importing from the '@heroui/react'
// barrel pulls in a provider chain that calls createContext, which throws at
// request time on the server — and neither `tsc` nor `next build` catches it,
// because it is a runtime failure in a file that compiles perfectly well. It
// surfaced only as a dev-overlay error on the live page.
//
// Asserted against the source text rather than by rendering: the failure is
// in module evaluation under the React server condition, which the jsdom test
// environment does not reproduce — a render here would pass while the real
// page threw.
describe('schedule loading.tsx', () => {
  const source = readFileSync(join(__dirname, 'loading.tsx'), 'utf-8')

  it('does not import the HeroUI barrel', () => {
    expect(source).not.toMatch(/from ['"]@heroui\//)
  })

  it('has no client directive, so it stays a server component', () => {
    expect(source).not.toMatch(/^['"]use client['"]/m)
  })
})

// The client boundary the above depends on: loading.tsx may render this, but
// only because the directive makes it a client component.
describe('schedule-skeleton.tsx', () => {
  const source = readFileSync(join(__dirname, '_components/schedule-skeleton.tsx'), 'utf-8')

  it("declares 'use client', since it imports the HeroUI barrel", () => {
    expect(source).toMatch(/^['"]use client['"]/m)
  })
})
