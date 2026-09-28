// Color coding for work areas.
//
// Source of truth for the first eight pairs:
// docs/design_handoff_admin_dashboard/README.md ("Work-area color coding").
// The remaining 22 were generated to be as distinguishable as possible from
// the handoff's eight and from each other, measured as OKLab distance rather
// than hue angle. That distinction matters: an earlier version of this file
// spaced them evenly around the hue circle, which put eight of the thirty in
// the green/teal band and produced pairs only 0.005 apart perceptually —
// indistinguishable as small avatar dots. Candidates vary in lightness and
// chroma as well as hue, which is what gives thirty pastels room to separate;
// the closest pair is now 0.0127 apart, and the tightest of those are the
// handoff's own colours, kept verbatim.
//
// Note this is about telling colours apart, not about collisions. With a
// 30-colour palette, six people have a ~41% chance of sharing one (the
// birthday problem) — that is inherent to hashing into a fixed set, not a
// defect here, and the colours are decorative, so a repeat is cosmetic.
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
  { name: 'amber2', bg: '#FFD7B2', fg: '#9F4600' }, // 4.66:1
  { name: 'sky', bg: '#A7F1FF', fg: '#006E89' }, // 4.64:1
  { name: 'grass', bg: '#E0EAB1', fg: '#5F6A00' }, // 4.67:1
  { name: 'grass2', bg: '#EAFFC7', fg: '#577600' }, // 4.91:1
  { name: 'green2', bg: '#BEF2CB', fg: '#00752F' }, // 4.67:1
  { name: 'rose2', bg: '#FFCFE4', fg: '#A33767' }, // 4.64:1
  { name: 'lime', bg: '#E7E4CA', fg: '#746200' }, // 4.68:1
  { name: 'cyan', bg: '#B8FFFF', fg: '#007883' }, // 4.68:1
  { name: 'violet2', bg: '#F8F1FF', fg: '#7551B3' }, // 5.31:1
  { name: 'orange', bg: '#FFD0C9', fg: '#A83632' }, // 4.67:1
  { name: 'teal2', bg: '#AAF4E7', fg: '#007361' }, // 4.64:1
  { name: 'azure', bg: '#DFFAFF', fg: '#0074AF' }, // 4.68:1
  { name: 'lime2', bg: '#FAEEB4', fg: '#816700' }, // 4.63:1
  { name: 'magenta', bg: '#F7D4FF', fg: '#87459F' }, // 4.68:1
  { name: 'emerald', bg: '#BCFEE3', fg: '#007C52' }, // 4.60:1
  { name: 'blue2', bg: '#C1E6FF', fg: '#1163B6' }, // 4.60:1
  { name: 'cyan2', bg: '#C9EBEC', fg: '#006F7A' }, // 4.66:1
  { name: 'green3', bg: '#D3FACA', fg: '#2E7B19' }, // 4.62:1
  { name: 'lime3', bg: '#F8E1AA', fg: '#865A00' }, // 4.70:1
  { name: 'orange2', bg: '#FFEDE6', fg: '#AE3F27' }, // 5.23:1
  { name: 'grass3', bg: '#E8F3CA', fg: '#5E7200' }, // 4.66:1
  { name: 'azure2', bg: '#C8F5FF', fg: '#006FA7' }, // 4.69:1
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
