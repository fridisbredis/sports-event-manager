ROLE:
Senior UI designer (Tailwind v3 + HeroUI v2)

DESIGN PRINCIPLES:

- Clean, spacious, calm — no visual noise, no gradients, no decorative elements
- Admin shell: web-first, information-dense but legible
- Official shell: mobile-first, glanceable, one clear thing per screen
- Color is reserved for actions and status, never decoration

DESIGN TOKENS:
`tailwind.config.ts` defines the shared tokens (sourced from
`docs/design_handoff_admin_dashboard/README.md`). These are real Tailwind
classes — use them:

- `ink` / `ink-soft` / `ink-muted` / `ink-label` / `ink-faint` — text hierarchy
- `surface` — the page ground admin surfaces sit on, and inset wells
- `edge` / `edge-field` / `edge-soft` — borders and dividers
- `status-ok-*`, `status-pending-*`, `status-neutral-*` — tenant-independent
  status colors (a confirmed badge must read the same in every theme)
- `destructive` / `destructive-solid` / `destructive-hover` — destructive text
  and buttons. Deliberately NOT named `danger`: extending `danger` would
  replace HeroUI's own palette wholesale and break `color="danger"` buttons.
- `rounded-card` / `rounded-card-sm` / `rounded-control`, `shadow-card`,
  `shadow-modal`, `tracking-tight` / `tracking-label`

TENANT COLOR SYSTEM:
Colors are per-tenant, not static. Palettes live in
`src/lib/theme/tenant-colors.ts` as `TENANT_PALETTES` — keys are
`'blue' | 'green' | 'purple'` (`green` is actually teal and `purple` replaced
an earlier orange; the keys are stored tenant settings, so renaming one needs
a data migration). Each palette is a set of raw `"H S% L%"` triplets (no
`hsl()` wrapper): `primary`, `primaryHover`, `primaryTint`, `primaryTintText`,
`secondary`, `accent`, `accentTint`, `accentTintText`.
`DEFAULT_TENANT_PALETTE` is `'blue'`.

`src/lib/theme/tenant-theme-style.tsx` injects the active palette at request
time as BOTH `--heroui-*` vars (so HeroUI's own `primary` utilities follow the
tenant) and `--tenant-*` vars. The `--tenant-*` ones are wired up as Tailwind
colors, so prefer the utility classes:

- `bg-tenant-primary`, `hover:bg-tenant-primary-hover`,
  `bg-tenant-primary-tint`, `text-tenant-primary-tint-text`,
  `bg-tenant-accent-tint`, `text-tenant-accent-tint-text`
- `bg-primary` / `text-primary` / `text-primary-foreground` — HeroUI's palette,
  driven by the same tenant values

Don't hardcode a new static accent in globals.css — add a palette to
`TENANT_PALETTES` instead. All palette values are AA-checked against white;
keep new ones at 4.5:1 or better and note the ratio, as the existing comments do.

Tier gating: the color theme is a Premium+ feature. Standard tenants get the
default palette.

Status badge mapping (Chip colors):
confirmed → success
invited → warning
draft → default
published → primary (accent)
removed → danger

TYPOGRAPHY:

- Headings use `font-display` (Manrope, via `src/fonts/manrope`)
- Body/UI text keeps the default system stack (`font-sans`)
- Weights: 400 body, 500 labels/subtitles, 600 headings and nav items
- Do not add further custom fonts

SPACING:

- 8px base unit — use Tailwind scale (gap-2=8px, gap-4=16px, p-6=24px, etc.)
- Cards: use `AppCard` or `CARD_SURFACE` from `src/components/ui/` — never
  hand-rolled `rounded-xl`/`shadow-md`, since Tailwind's and HeroUI's
  same-named classes resolve to different values
- Tables: row hover required; zebra-stripe (isStriped) on dense admin tables
