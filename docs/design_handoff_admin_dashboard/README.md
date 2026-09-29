# Handoff: Sports Event Manager — Admin Dashboard (WCAG color update)

## Overview

Admin dashboard for managing a sports event (Viadal 2026): event configuration, work areas, officials roster, scheduling grid, participant/official communication, and account settings. This round of work re-themed the UI with a WCAG AA–compliant color system (Blue/Green/Orange), added an Account page, three modals (Edit stage, Add official, Remove official confirm), and an interactive stage picker dropdown in Scheduling.

## About the Design Files

The file in this bundle (`Admin Color Update.dc.html`) is a **design reference built in HTML** — a high-fidelity prototype showing intended look, layout, and interaction, not production code to copy directly. Recreate these screens in the target codebase's existing environment (React, Vue, etc.) using its established component patterns and libraries. If no frontend framework exists yet in the target repo, choose the most appropriate one and implement there.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and most interaction states are final. Treat hex values, font choices, and spacing numbers below as the source of truth.

## Design Tokens

### Color themes (pick one active theme at a time; CSS custom properties in the file: `--p`, `--ph`, `--pt`, `--ptx`, `--s`, `--at`, `--atx`)

- **Blue** (default): primary `#0062D1`, primary-hover `#0052B0`, primary-tint `#E8F1FD`, primary-tint-text `#0052B0`, secondary `#1E40AF`, accent-tint `#E3F4FC`, accent-tint-text `#0072B0`
- **Green**: primary `#15803D`, primary-hover `#0F6334`, primary-tint `#DCF3E4`, primary-tint-text `#0F6334`, secondary `#0F766E`, accent-tint `#ECFDF5`, accent-tint-text `#4D7A0F`
- **Orange**: primary `#C2410C`, primary-hover `#A3380A`, primary-tint `#FFEDD5`, primary-tint-text `#92400E`, secondary `#B45309`, accent-tint `#FFEDD5`, accent-tint-text `#92400E`

All theme colors were tuned in lightness (same hue) to pass WCAG 2.2 AA against white: 4.5:1 for text, 3:1 for UI borders/large text. See the "Färgtokens (WCAG)" screen in the file for the before/after contrast table.

> **The palette list above is historical; `src/lib/theme/tenant-colors.ts` is the live source.** Green and Orange were replaced by teal and purple (both failed AA), and the three `primary-tint` values were re-solved so all three themes share teal's perceived brightness — HSL lightness is not perceptual, so they carry different L% numbers on purpose. Check the code before treating a hex above as current.

### Work-area color coding (8-color rotating palette, assigned per work-area name)

Pastel background + saturated foreground pairs, e.g. blue `bg #DCEAFE / fg #1D4ED8`, violet `bg #E5DFFC / fg #7C3AED`, teal `bg #D3F5E7 / fg #0F766E`, rose `bg #FCE1E4 / fg #BE123C`, amber `bg #FCEFD1 / fg #B45309`, fuchsia `bg #F7E1FA / fg #A21CAF`, green `bg #DCF5E1 / fg #15803D`, indigo `bg #DEE3FC / fg #4338CA`.

- Decorative dots/bullets use a **pastel** version of the foreground (`color-mix(in srgb, fg 65%, white)`), never the fully-saturated hue.
- Cell borders in the scheduling grid use a **soft** mix (`color-mix(in srgb, fg 35%, white)`) — never full-strength saturation — to keep the grid calm, not alarm-like.
- Text/labels inside filled cells keep the full-saturation `fg` for contrast.

### Neutrals & status

- Body text `#111827`, secondary text `#374151`/`#4B5563`, labels/help text `#5B6472`/`#8A93A1`, field borders `#8C94A1` (3:1 vs white), dividers `#E3E6EB`/`#EEF0F3`, card background `#FFFFFF`, page background gradient `#F4F6FA → #F7F8FA`.
- Destructive/delete text and buttons: `#B91C1C` (list actions), modal destructive button `#BE123C` (hover `#9F1239`).
- Invited badge: bg `#FEF3C7` / text `#78350F`. Confirmed/Published badge: bg `#DCF3E4` / text `#14532D`.

### Typography

- Headings (`h1`, section card titles, modal titles): **Manrope**, weight 800 for page `h1`s, 600–700 for smaller headings, `letter-spacing: -0.02em`. Loaded via Google Fonts (`Manrope:wght@600;700;800`).
- Body/UI text: system font stack (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`).
- Table/grid row primary text and schedule-cell labels: weight 500 (kept intentionally light — this was tuned down from 600/700 during review for a calmer, less "heavy" feel).
- Uppercase section labels (e.g. "IDENTITY", "STAGES", "PUBLISH STATUS"): 12px, weight 700, `letter-spacing: 0.1–0.12em`, color `#8A93A1`.

### Spacing / shape

- Card border-radius: 14–16px. Pill/badge/button radius: 8–10px (buttons), 999px (pills/badges/segmented controls).
- Card shadow: `0 1px 2px rgba(17,24,39,0.03)`, optionally combined with an inset top accent line: `inset 0 2px 0 color-mix(in srgb, <theme color> 28%, white)` — a faint 28%-strength top border, not a bold stripe.
- Standard card padding: 20–24px. Table row min-height: 58px (Officials), 40px (schedule grid cells).

## Screens / Views

All screens share a fixed left sidebar (252px, white, `#E3E6EB` right border) with nav items (Dashboard, Event configuration, Work areas, Officials, Scheduling, Communication, Färgtokens) plus a bottom-pinned Account / Log out section. Main content area: `max-width: 1240px`, padding `32px 40px 64px`.

1. **Dashboard** — event header (logo tile, name, type/dates, Published badge), publish-status card, officials count card, scheduling-warnings card, and a grid of "Admin area" quick-link cards.
2. **Event configuration** — two-column layout: Identity (logo, color theme picker, name/type/description fields, dates/granularity) and Schedule & setup (Stages list with Race/Non-race badges, time ranges, Edit/Delete actions). "Edit" opens the **Edit stage modal**.
3. **Work areas** — one card per event stage/group, each with a Name/Operating windows/Capacity table of work-area rows (pastel dot + name), and a right-aligned "+ Add work area" link separated by a top divider.
4. **Work area detail** — back link, name/delete/save header, two-column form (identity, operating windows, capacity, checklists).
5. **Officials** — header + "Add official" button (opens **Add official modal**), table (Name/Mobile/Status/Actions), status badges (Invited/Confirmed), Re-send invite / Remove actions (Remove opens **Remove official confirm modal**).
6. **Scheduling** — header with an interactive **stage picker dropdown** (click to open, checkmark on selected stage), date pager, Print button, By-person/By-work-area toggle, and the scheduling grid (10 hourly columns) with fraction cells, hatched "outside operating window" cells, and a legend row.
7. **Communication** — channel toggle (Participants/Officials), new-announcement card, timeline of sent messages.
8. **Account** (new) — centered avatar initial, editable Name field (same bordered input style as other fields — not greyed out), read-only Mobile number field (grey background), Notifications card (SMS updates toggle), Your schedule card (checkbox + assignment count + chevron, links to schedule).
9. **Färgtokens (WCAG)** — reference/documentation screen showing before/after hex + contrast ratio for each theme's Primary/Secondary/Accent, plus shared neutrals.

## Modals

Rendered as a fixed, full-viewport `rgba(17,24,39,0.45)` backdrop with a centered white card (`border-radius: 16px`, `box-shadow: 0 24px 48px -12px rgba(17,24,39,0.25)`), an "×" close button top-right, Cancel + primary action buttons bottom-right.

- **Edit stage**: Stage name, Type (Race/Non-race segmented), Start/end time (with calendar icon), Venue, Category type (Distance/Time segmented), Distance(s). Primary button: "Save stage".
- **Add official**: Name, Country + Mobile number (two-column), helper text "An SMS invite is sent to this number." Primary button: "Send invite".
- **Remove official?**: warning copy naming the official, destructive "Remove" button (`#BE123C`).

## Interactions & Behavior

- Sidebar nav: click switches the active view, scrolls to top; active item gets `background: var(--pt)`, `color: var(--ptx)`, `font-weight: 600`, and a 3px left inset bar in the theme primary color.
- Color theme picker (Event configuration): 3 swatch options (Blue/Green/Orange), click sets the whole app's CSS variables.
- Scheduling stage dropdown: click toggles an absolutely-positioned menu below the trigger; selecting an option closes it and updates the label.
- By-person / By-work-area toggle: segmented control, active segment filled with theme primary color and white text.
- All buttons/cards use a 0.15s ease transition on background/border/color/shadow/transform; hover states are subtle (background tint or border color change) — no drop shadows on button hover, only on card hover (`translateY(-1px)` + soft shadow on Dashboard quick-links).

## Assets

No external image assets — all icons are inline SVG (Lucide-style outline icons, stroke-based). Font: Manrope from Google Fonts.

## Files

- `Admin Color Update.dc.html` — the full prototype (all 9 screens + 3 modals in one file, view switched via internal state).
- `screenshots/` — reference screenshots of every screen (`01-dashboard.png` … `09-account.png`) and each modal (`modal-edit-stage.png`, `modal-add-official.png`, `modal-remove-official.png`).
