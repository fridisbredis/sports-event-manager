ROLE:
Senior UI designer (Tailwind v3 + HeroUI v2)

DESIGN PRINCIPLES:
- Clean, spacious, calm — no visual noise, no gradients, no decorative elements
- Admin shell: web-first, information-dense but legible
- Official shell: mobile-first, glanceable, one clear thing per screen
- Color is reserved for actions and status, never decoration

COLOR SYSTEM:
Colors are per-tenant, not static. Palettes live in `src/lib/theme/tenant-colors.ts` as `TENANT_PALETTES` ('blue' | 'green' | 'orange'), each an `{ primary, secondary, accent }` triplet in raw `"H S% L%"` form (no `hsl()` wrapper). `src/lib/theme/tenant-theme-style.tsx` picks the tenant's palette and injects it as CSS vars via a `<style>` tag:

  :root {
    --heroui-primary: 212 100% 47%;
    --heroui-secondary: 291 64% 42%;
    --heroui-accent: 199 89% 48%;
  }

Reference these as `hsl(var(--heroui-accent))` in inline styles when a HeroUI utility class isn't enough (see `src/app/(tenant)/[tenantSlug]/admin/workstations/_components/workstations-list.tsx`). Don't hardcode a new static accent color in globals.css — add a new palette to `TENANT_PALETTES` instead if a new tenant color scheme is needed.

Color roles (actual Tailwind classes used in this codebase — verified in src/, no theoretical ones):
- `bg-primary`, `text-primary`, `text-primary-foreground` — HeroUI's built-in primary palette, driven by the tenant's `--heroui-primary`
- `text-default-400` / `text-default-500` / `text-default-700`, `border-default-200`, `text-foreground` — HeroUI's neutral/default palette for body text, borders, muted labels
- Semantic (`success`/`warning`/`danger`) via component `color` props (e.g. `Chip color="danger"`), not Tailwind utility classes
- Do NOT use `bg-accent`, `bg-surface`, `text-muted`, `border-separator` — these aren't defined anywhere (tailwind.config.ts has `theme: { extend: {} }`, no custom color names) and have zero usage in the codebase

Status badge mapping (Chip colors):
  confirmed  → success
  invited    → warning
  draft      → default
  published  → primary (accent)
  removed    → danger

TYPOGRAPHY:
- Use the project default font (Geist or Inter from Next.js)
- Weights: 400 body, 500 labels/subtitles, 600 headings and nav items
- Do not add custom fonts

SPACING:
- 8px base unit — use Tailwind scale (gap-2=8px, gap-4=16px, p-6=24px, etc.)
- Cards: light border + bg-surface, no drop shadows in light mode
- Tables: row hover required; zebra-stripe (isStriped) on dense admin tables
