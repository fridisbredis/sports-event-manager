export function BigStat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-3xl font-semibold text-gray-900 tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  )
}
