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
  // N18's read-only mobile schedule, for checking coverage on site. SCHED-01's
  // editable grid is not gated — this is the phone-shaped companion to it.
  mobileSchedule: 'premium',
} as const satisfies Record<string, Tier>

export type TierFeature = keyof typeof TIER_FEATURES

// N20: the maximum number of tenant_admins a tenant may have, by tier.
//
// Separate from TIER_FEATURES because this is a limit, not a capability:
// hasFeature's "premium and up" cumulative rule is meaningless for a number,
// and reading a count through a boolean gate would mean one lookup per
// possible value. A tenant on an unrecognised tier gets the lowest cap rather
// than no cap at all — failing closed, matching hasFeature's reasoning, but
// without locking an existing admin out of a tenant whose tier was renamed.
export const MAX_TENANT_ADMINS: Record<Tier, number> = {
  standard: 1,
  premium: 3,
  professional: 10,
}

export function maxTenantAdmins(tier: string): number {
  if (!isTier(tier)) return MAX_TENANT_ADMINS[TIER_ORDER[0]]

  return MAX_TENANT_ADMINS[tier]
}

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
