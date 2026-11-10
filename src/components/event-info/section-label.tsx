// Thin wrapper over the app-wide .section-label utility (globals.css) so the
// uppercase section headings here read the same as every other one in the
// app. It used to restate the rule locally with text-gray-900, which made
// these headings darker than the label style everywhere else — they sat as
// loud as the card titles below them rather than quietly above them.
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="section-label mb-3">{children}</p>
}
