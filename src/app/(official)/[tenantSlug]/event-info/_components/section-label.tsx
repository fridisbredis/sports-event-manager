export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-bold text-gray-900 uppercase tracking-widest mb-3">
      {children}
    </p>
  )
}
