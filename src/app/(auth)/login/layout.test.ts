import { describe, it, expect, vi } from 'vitest'
import { metadata } from './layout'
import { metadata as rootMetadata } from '../../layout'
import { metadata as privacyMetadata } from '../../privacy/page'

// The root layout loads a local font through next/font, which only works
// inside Next's compiler; its metadata export is all this file reads.
vi.mock('@/fonts/manrope', () => ({ heading: { variable: '' } }))

// N64: search results and AI summaries guessed this was a participant or
// race-results portal. The sign-in page now says what the site is.
describe('sign-in page metadata', () => {
  it('says who signs in here', () => {
    expect(metadata.title).toMatch(/organisers and officials/i)
  })

  it('says what the site is not', () => {
    expect(metadata.description).toMatch(/not a participant or race-results portal/i)
  })

  it('opts in to indexing', () => {
    expect(metadata.robots).toMatchObject({ index: true })
  })
})

// The default is noindex, so a future public route stays out of the index
// until someone opts it in, as /login and /privacy do.
describe('indexing defaults', () => {
  it('root layout is noindex', () => {
    expect(rootMetadata.robots).toMatchObject({ index: false })
  })

  it('privacy policy opts in to indexing', () => {
    expect(privacyMetadata.robots).toMatchObject({ index: true })
  })
})
