// Shared with AppCard (app-card.tsx). Use this constant instead of retyping
// HeroUI's border/shadow/radius tokens whenever a raw element needs the same
// "white panel on the gray admin background" look but can't use AppCard
// itself — e.g. a scrollable grid container that needs its own overflow and
// height rules on the same element.
export const CARD_SURFACE = 'border border-gray-200 rounded-large bg-white shadow-medium'
