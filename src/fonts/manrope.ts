import localFont from 'next/font/local'

/**
 * Manrope, self-hosted from src/fonts so the production build never fetches
 * from Google Fonts — the same constraint that moved Space Grotesk off
 * next/font/google (see MNT-06 / F-MNT-04 in docs/quality-requirements.md).
 *
 * Single variable file covering the 600-800 range the design handoff uses:
 * 600-700 for smaller headings, 800 for page h1s. Latin subset only, matching
 * space-grotesk-latin.woff2.
 *
 * Licensed under OFL 1.1 — see src/fonts/OFL-Manrope.txt.
 */
export const heading = localFont({
  src: './manrope-latin.woff2',
  weight: '600 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-manrope',
})
