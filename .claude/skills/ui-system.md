ROLE:
Senior Frontend Engineer (React + Tailwind + HeroUI v2)

DESIGN PRINCIPLES:

- Clean, minimal UI
- Mobile-first (official shell), web-first (admin shell)
- Clear hierarchy (title → content → action)

LAYOUT RULES:

- Use flex/grid, 8px spacing system (gap-2, gap-4, p-6…)
- Avoid deep nesting of divs
- Use the project's design tokens for color (see designer.md: ink/surface/edge/status/destructive, tenant-_ for per-tenant accents) plus HeroUI's semantic tokens (bg-primary, text-primary, text-default-_), plain Tailwind for spacing/layout

COMPONENT RULES:

- Functional components only, small and reusable, explicit props
- Use HeroUI v2 components before writing custom markup — see hero-ui.md for catalog
- Form fields: always import Input/Textarea/Select/TimeInput/DateRangePicker from `@/components/ui/form-fields`, never raw HeroUI — the raw ones render with a grey background that then needs !important hacks
- White cards: always `AppCard` or `CARD_SURFACE` from `@/components/ui/`, never hand-rolled rounded/shadow classes
- Style via `className` on the component or its documented sub-parts (e.g. `ModalContent`, `DropdownMenu`) — use `classNames` slot objects for components that expose them, per hero-ui.md

TAILWIND RULES:

- Use either the project's own tokens from `tailwind.config.ts` (ink, surface, edge, status-_, destructive, tenant-_, rounded-card, shadow-card) or the colors HeroUI's plugin generates (bg-primary, text-primary, text-primary-foreground, text-default-400/500/700, border-default-200, text-foreground). Both are real — see designer.md for the full list.
- Don't invent names outside those two sets. Check `tailwind.config.ts` before using a color class you haven't seen in the codebase.
- Per-tenant accents: prefer the `tenant-*` utilities (`bg-tenant-primary`, `hover:bg-tenant-primary-hover`, `bg-tenant-accent-tint`). Inline `hsl(var(--tenant-*))` only where a utility can't reach.
- No hex values inline — colors come from the config tokens or the tenant CSS vars
- Standard Tailwind for spacing/layout: p-4, gap-2, max-w-xl, etc.
- No custom CSS unless there's no other option

UX RULES:

- Always show loading states (Spinner or Skeleton)
- Always handle error states (isInvalid + errorMessage on TextField)
- Forms must be simple and linear

COMPONENT MAPPING (app pattern → HeroUI v2):
Primary action button → Button (color="primary")
Secondary / cancel → Button (variant="light" or "bordered")
Destructive action → Button (color="danger")
Status badge → Chip — colors per designer.md, or the `status-*` tokens
Data table → Table + isStriped; emptyContent prop for empty state
Form input → Input (label, isInvalid, errorMessage props — single compound component, not a TextField tree)
Select / dropdown field → Select + SelectItem
Modal / dialog → Modal + ModalContent + ModalHeader + ModalBody + ModalFooter
Toast notification → addToast() from src/lib/toast.ts (wraps HeroUI's addToast)
Tabs → Tabs + Tab
Collapsible section → Accordion + AccordionItem
Loading → Spinner (centered in flex container)
Dropdown menu (row actions) → Dropdown + DropdownTrigger + DropdownMenu + DropdownItem
Navigation sidebar → Custom layout with Tailwind — HeroUI has no sidebar component
Bottom tab bar (mobile) → Custom fixed bottom nav — HeroUI has no bottom tab bar component

ADMIN SHELL LAYOUT (plain Tailwind):

  <div className="flex h-screen">
    <aside className="w-60 flex-shrink-0 border-r border-edge">
    <main className="flex-1 overflow-y-auto p-8">

Active sidebar nav item: bg-tenant-primary-tint text-tenant-primary-tint-text
Inactive: text-ink-muted hover:bg-surface
(Read the real shell in src/app/(tenant)/ before restyling it — don't take this
sketch as current.)

OFFICIAL SHELL LAYOUT (mobile-first):
Full viewport width, bottom tab bar position-fixed at bottom-0
Add pb-16 to all scrollable content to clear the tab bar

AUTH UI PATTERNS:

- Phone input screen
- OTP input screen
- Loading verification state
- Success redirect state

REPLACING EXISTING COMPONENTS (one screen at a time):
<button> → Button
<input> → Input from @/components/ui/form-fields (label, isInvalid, errorMessage)
<select> → Select + SelectItem from @/components/ui/form-fields

  <table>          → Table
  status text/span → Chip
  custom modal     → Modal + ModalContent + ModalHeader + ModalBody + ModalFooter
  Layout divs, headings, plain text → keep as plain Tailwind
