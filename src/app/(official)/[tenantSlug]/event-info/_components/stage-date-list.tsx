// The dates-by-stage block: a plain label/value list, not cards. These are
// single facts per stage, and wrapping each one in its own card would give a
// one-line date the same visual weight as a whole programme entry below.
//
// The reference design annotates one row as "Stage 1 · Prologue". There is
// no field behind that: event_stages carries stage_type ('race' | 'non_race')
// and race_type ('distance' | 'time'), neither of which marks a prologue. So
// the row shows the stage's own name and nothing is invented; the qualifier
// can be added here once the stage model grows a field to carry it.
interface StageDate {
  id: string
  name: string
  date: string
}

export function StageDateList({ stages }: { stages: StageDate[] }) {
  return (
    <dl className="flex flex-col gap-2">
      {stages.map((stage) => (
        <div key={stage.id} className="flex items-baseline justify-between gap-4">
          <dt className="min-w-0 text-[15px] font-bold leading-relaxed text-ink">{stage.name}</dt>
          <dd className="shrink-0 text-[15px] leading-relaxed text-ink-muted">{stage.date}</dd>
        </div>
      ))}
    </dl>
  )
}
