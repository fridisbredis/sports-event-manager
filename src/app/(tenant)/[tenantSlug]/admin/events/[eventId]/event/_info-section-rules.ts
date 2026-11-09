// N38: limits shared by the info-section modal (client) and saveInfoSection
// (server), so the two can't drift. Decided 2026-11-09 (card N38).

export const INFO_SECTION_BUCKET = 'event-info-images'

/** Longest edge the client downscales to before upload. */
export const INFO_SECTION_IMAGE_MAX_DIMENSION = 1600

/**
 * Server-side ceiling. Must stay under Next.js's 1 MB Server Action body cap
 * (see MAX_LOGO_BYTES); a 1600px WebP at 0.85 is typically 150-400 kB.
 */
export const INFO_SECTION_MAX_IMAGE_BYTES = 900 * 1024

/** What the file picker accepts; the client re-encodes all of them to WebP. */
export const INFO_SECTION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export const INFO_SECTION_LIMITS = {
  title: 80,
  body: 4000,
  linkLabel: 60,
} as const
