export function BigStat({
  value,
  label,
  emphasis = false,
}: {
  value: number
  label: string
  /** Draws the figure in the tenant's primary colour — used for the number
   *  that is the point of the card (confirmed officials), so the pair reads
   *  as "of these, this many". */
  emphasis?: boolean
}) {
  return (
    <div>
      <div
        className={`text-[32px] font-bold leading-none tracking-tight tabular-nums ${
          emphasis ? 'text-tenant-primary' : 'text-ink'
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[13px] text-ink-muted">{label}</div>
    </div>
  )
}
