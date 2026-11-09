// N38: what EVT-02 and INFO-01 share about info sections.

/** Storage bucket for section images (public, migration 20261109180943). */
export const INFO_SECTION_BUCKET = 'event-info-images'

/**
 * One section as the cached RPCs return it (the `info_sections` key of
 * get_admin_event_cached and get_event_info_cached).
 */
export interface InfoSection {
  id: string
  title: string
  body: string | null
  image_path: string | null
  link_url: string | null
  link_label: string | null
  position: number
}

/**
 * Public URL of a section image. Built from the path rather than stored, so
 * the row does not carry the project's hostname — the same string
 * getPublicUrl returns, without needing a client to produce it.
 */
export function infoSectionImageUrl(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${base}/storage/v1/object/public/${INFO_SECTION_BUCKET}/${encoded}`
}

/**
 * Text for a section's link when the admin gave no label: the host, without
 * "www.", which is what someone reading the card needs to know before they
 * tap. Falls back to the raw URL if it does not parse.
 */
export function infoSectionLinkText(url: string, label: string | null): string {
  if (label?.trim()) return label.trim()
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
