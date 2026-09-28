// Shared with AppCard (app-card.tsx). Use this constant instead of retyping
// HeroUI's border/shadow/radius tokens whenever a raw element needs the same
// "white panel on the gray admin background" look but can't use AppCard
// itself — e.g. a scrollable grid container that needs its own overflow and
// height rules on the same element.
// Values come from docs/design_handoff_admin_dashboard/README.md: a 16px
// radius, an #E3E6EB hairline border, and a very light shadow (0 1px 2px at 3%
// rather than HeroUI's heavier shadow-medium) — the cards are meant to sit
// quietly on the page rather than lift off it.
export const CARD_SURFACE = 'border border-edge rounded-card bg-white shadow-card'
