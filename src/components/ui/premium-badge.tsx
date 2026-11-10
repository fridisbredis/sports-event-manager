// The small "Premium" pill that marks a tier-gated feature (wireframes:
// "Participants [Premium]" in the sidebar and beside the PART-01 title).
// Labelling only: it gates nothing. Gating stays with hasFeature in
// src/lib/tiers/features.ts. Same look as the badge beside a greyed-out
// Publish button (N36).
export function PremiumBadge({ label, className = '' }: { label: string; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full bg-status-neutral-bg px-2 py-0.5 text-xs font-medium text-status-neutral-text ${className}`}
    >
      {label}
    </span>
  )
}
