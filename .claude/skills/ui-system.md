ROLE:
Senior Frontend Engineer (React + Tailwind + HeroUI v2)

DESIGN PRINCIPLES:

- Clean, minimal UI
- Mobile-first (official shell), web-first (admin shell)
- Clear hierarchy (title → content → action)

LAYOUT RULES:

- Use flex/grid, 8px spacing system (gap-2, gap-4, p-6…)
- Avoid deep nesting of divs
- Use HeroUI's built-in semantic tokens for color (bg-primary, text-primary, text-default-400/500/700, border-default-200, text-foreground), plain Tailwind for spacing/layout

COMPONENT RULES:

- Functional components only, small and reusable, explicit props
- Use HeroUI v2 components before writing custom markup — see hero-ui.md for catalog
- Style via `className` on the component or its documented sub-parts (e.g. `ModalContent`, `DropdownMenu`) — use `classNames` slot objects for components that expose them, per hero-ui.md

TAILWIND RULES:

- Only use color classes HeroUI's plugin actually generates: bg-primary, text-primary, text-primary-foreground, text-default-400/500/700, border-default-200, text-foreground
- Don't invent classes like bg-accent, bg-surface, text-muted, border-separator — tailwind.config.ts has no custom color names (`theme: { extend: {} }`) and these have zero usage in the codebase
- Per-tenant accent color: `hsl(var(--heroui-accent))` inline style, not a Tailwind class — see designer.md
- No hex values inline — colors come from HeroUI's palette or the tenant CSS vars
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
Status badge → Chip — colors per designer.md
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
    <aside className="w-60 flex-shrink-0 border-r border-separator">
    <main className="flex-1 overflow-y-auto p-8">

Active sidebar nav item: bg-accent/10 text-accent
Inactive: text-muted hover:bg-surface

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
<input> → Input (label, isInvalid, errorMessage props)
<select> → Select + SelectItem

  <table>          → Table
  status text/span → Chip
  custom modal     → Modal + ModalContent + ModalHeader + ModalBody + ModalFooter
  Layout divs, headings, plain text → keep as plain Tailwind
