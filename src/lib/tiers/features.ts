// Feature tiers (SYS-02).
//
// `tenants.tier` is set per tenant in the system-admin UI and was, until this
// module, a label nothing read. Everything that makes a feature tier-specific
// goes through here.

export const TIER_ORDER = ['standard', 'premium', 'professional'] as const

export type Tier = (typeof TIER_ORDER)[number]

// The minimum tier that unlocks each feature. To make a NEW feature
// tier-specific, add a line here rather than comparing `tenant.tier` out in
// the app code: TIER_ORDER is then the only place that knows professional
// outranks premium outranks standard, and a feature's tier can be changed in
// one edit.
//
// `satisfies` rather than a plain annotation so a misspelled tier is a type
// error here instead of a silent `false` at runtime, while the keys stay
// literal for TierFeature below.
export const TIER_FEATURES = {
  // EVT-01's colour theme picker. Standard tenants render DEFAULT_TENANT_PALETTE.
  colorTheme: 'premium',
} as const satisfies Record<string, Tier>

export type TierFeature = keyof typeof TIER_FEATURES

export function isTier(value: string): value is Tier {
  return (TIER_ORDER as readonly string[]).includes(value)
}

// Whether `tier` unlocks `feature`. Cumulative: a feature listed at 'premium'
// is also available on 'professional', matching how the tiers were described
// ("available from Premium and up"). A feature that belonged to exactly one
// tier would not fit this model — that is not how the tiers are sold, so it
// is deliberately not built for.
//
// An unrecognised tier (a value predating a rename, or a hand-edited row)
// fails closed to no features rather than defaulting to the lowest tier's
// set, so a typo cannot silently grant access.
export function hasFeature(tier: string, feature: TierFeature): boolean {
  if (!isTier(tier)) return false

  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(TIER_FEATURES[feature])
}

// The tiers that unlock `feature`, lowest first. Drives SYS-02's per-tier
// description lists so they are generated from the same table that governs
// behaviour and cannot drift from it.
export function tiersWithFeature(feature: TierFeature): Tier[] {
  return TIER_ORDER.filter((tier) => hasFeature(tier, feature))
}

// The features unlocked at `tier`, in TIER_FEATURES declaration order.
export function featuresForTier(tier: Tier): TierFeature[] {
  return (Object.keys(TIER_FEATURES) as TierFeature[]).filter((feature) =>
    hasFeature(tier, feature)
  )
}
