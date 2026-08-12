import localFont from 'next/font/local'

/**
 * Space Grotesk, self-hosted from src/fonts so the production build never
 * fetches from Google Fonts (see MNT-06 in docs/quality-requirements.md).
 *
 * Single variable file covering the full wght axis (300-700), which replaces
 * the two static weights (300, 500) the previous next/font/google call loaded.
 * Licensed under OFL 1.1 — see src/fonts/OFL.txt.
 */
export const display = localFont({
  src: './space-grotesk-latin.woff2',
  weight: '300 700',
  style: 'normal',
  display: 'swap',
  variable: '--font-display',
})
