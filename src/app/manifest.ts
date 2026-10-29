import type { MetadataRoute } from 'next'

// N31: makes the app installable to the home screen. That is a precondition
// for web push on iOS (16.4+), which only delivers to a site opened from a
// home screen icon, never to a Safari tab.
//
// Served at /manifest.webmanifest. Browsers fetch it WITHOUT cookies, so the
// proxy matcher must keep excluding it — otherwise it is redirected to /login
// and installation silently loses its name and icons.
//
// The icons are rendered from src/app/icon.svg. The maskable one has a
// full-bleed background with the glyph inside the safe zone, so Android
// launchers can crop it to a circle or squircle without clipping the flag.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Sports Event Manager',
    short_name: 'Event Manager',
    description: 'Plan and execute your sport event',
    // Root does role routing, so every role lands on its own home screen.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#006FEE',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
