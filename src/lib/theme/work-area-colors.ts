// Color coding for work areas.
//
// Source of truth for the first eight pairs:
// docs/design_handoff_admin_dashboard/README.md ("Work-area color coding").
// The remaining 22 were generated in the same register — pastel background at
// ~80% saturation / ~92.5% lightness, saturated foreground at 75% saturation
// with lightness lowered until the pair clears 4.5:1 — and their hues chosen
// to sit as far as possible from the handoff's eight and from each other. No
// two of the 30 hues are closer than 7 degrees apart.
//
// A note on the handoff's own eight: violet (4.42:1), amber (4.40:1) and green
// (4.34:1) fall just short of WCAG AA 4.5:1 for normal-size text. They are
// kept exactly as delivered rather than silently re-tuned — they are the
// designed palette, and the labels that use them are 500-weight 13-14px. The
// 22 generated pairs are all held to 4.6:1 to leave margin.

export interface WorkAreaColor {
  /** Stable identifier. Never renders; safe to reference from tests. */
  name: string
  /** Pastel background for chips, dots and filled schedule cells. */
  bg: string
  /** Saturated foreground for text and icons drawn on `bg`. */
  fg: string
}

export const WORK_AREA_COLORS: readonly WorkAreaColor[] = [
  // --- the eight from the handoff, verbatim ---
  { name: 'blue', bg: '#DCEAFE', fg: '#1D4ED8' }, // 5.50:1
  { name: 'violet', bg: '#E5DFFC', fg: '#7C3AED' }, // 4.42:1
  { name: 'teal', bg: '#D3F5E7', fg: '#0F766E' }, // 4.69:1
  { name: 'rose', bg: '#FCE1E4', fg: '#BE123C' }, // 5.10:1
  { name: 'amber', bg: '#FCEFD1', fg: '#B45309' }, // 4.40:1
  { name: 'fuchsia', bg: '#F7E1FA', fg: '#A21CAF' }, // 5.15:1
  { name: 'green', bg: '#DCF5E1', fg: '#15803D' }, // 4.34:1
  { name: 'indigo', bg: '#DEE3FC', fg: '#4338CA' }, // 6.21:1
  // --- 22 generated to extend the set to 30 ---
  { name: 'red', bg: '#FBDFDD', fg: '#BB281B' }, // 4.87:1
  { name: 'orange', bg: '#FBE5DD', fg: '#B04419' }, // 4.71:1
  { name: 'orange2', bg: '#FBEBDD', fg: '#9E5817' }, // 4.67:1
  { name: 'yellow', bg: '#FBF8DD', fg: '#7D7012' }, // 4.66:1
  { name: 'yellow2', bg: '#F9FBDD', fg: '#6F7611' }, // 4.65:1
  { name: 'lime', bg: '#F4FBDD', fg: '#5F7811' }, // 4.71:1
  { name: 'lime2', bg: '#EDFBDD', fg: '#4B7B12' }, // 4.70:1
  { name: 'grass', bg: '#E8FBDD', fg: '#397D12' }, // 4.68:1
  { name: 'green2', bg: '#E2FBDD', fg: '#267F12' }, // 4.62:1
  { name: 'green3', bg: '#DDFBDD', fg: '#127F12' }, // 4.65:1
  { name: 'emerald', bg: '#DDFBE8', fg: '#127F3C' }, // 4.61:1
  { name: 'teal2', bg: '#DDFBF2', fg: '#127D5D' }, // 4.65:1
  { name: 'teal3', bg: '#DDFBF6', fg: '#127D6B' }, // 4.60:1
  { name: 'cyan', bg: '#DDF9FB', fg: '#127881' }, // 4.72:1
  { name: 'sky', bg: '#DDF1FB', fg: '#17719E' }, // 4.64:1
  { name: 'indigo2', bg: '#DDDDFB', fg: '#1D1BBB' }, // 8.21:1
  { name: 'violet2', bg: '#E8DDFB', fg: '#561BBB' }, // 7.12:1
  { name: 'purple', bg: '#EDDDFB', fg: '#701BBB' }, // 6.37:1
  { name: 'purple2', bg: '#F2DDFB', fg: '#8B1BBB' }, // 5.56:1
  { name: 'fuchsia2', bg: '#FBDDF7', fg: '#B51AA0' }, // 4.64:1
  { name: 'pink', bg: '#FBDDEF', fg: '#BB1B7E' }, // 4.67:1
  { name: 'rose2', bg: '#FBDDE8', fg: '#BB1B56' }, // 4.88:1
] as const

/**
 * FNV-1a over the work area's id.
 *
 * The brief asked for a color "randomised at creation". Deriving it from the
 * immutable id gets that — the assignment is arbitrary with respect to
 * anything a user controls — while staying a pure function, so it needs no
 * column, no backfill for the rows that already exist, and renders the same on
 * server and client. Renaming a work area keeps its color; only deleting and
 * recreating it draws a new one.
 */
export function workAreaColor(workAreaId: string): WorkAreaColor {
  let hash = 0x811c9dc5
  for (let i = 0; i < workAreaId.length; i++) {
    hash ^= workAreaId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return WORK_AREA_COLORS[(hash >>> 0) % WORK_AREA_COLORS.length]
}

/**
 * Pastel version of a foreground color, for decorative dots and bullets.
 * Per the handoff these are never drawn at full saturation.
 */
export function workAreaDotColor(color: WorkAreaColor): string {
  return `color-mix(in srgb, ${color.fg} 65%, white)`
}

/**
 * Soft mix for schedule-grid cell borders — the handoff calls for a calm grid,
 * not an alarm-like one, so borders never use the full-strength hue.
 */
export function workAreaBorderColor(color: WorkAreaColor): string {
  return `color-mix(in srgb, ${color.fg} 35%, white)`
}
