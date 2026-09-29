import { AppCard } from '@/components/ui/app-card'

type Status = 'ok' | 'error' | 'unknown'

// The handoff's status pairs rather than raw Tailwind palette steps, so an
// "Up" badge here reads identically to a Confirmed/Published badge elsewhere.
const STATUS_STYLES: Record<Status, string> = {
  ok: 'bg-status-ok-bg text-status-ok-text',
  error: 'bg-destructive/10 text-destructive',
  unknown: 'bg-status-neutral-bg text-status-neutral-text',
}

interface StatusCardLink {
  label: string
  href: string
}

interface StatusCardProps {
  title: string
  status?: Status
  statusLabels?: Record<Status, string>
  facts?: { label: string; value: string }[]
  links: StatusCardLink[]
  note?: string
}

export function StatusCard({ title, status, statusLabels, facts, links, note }: StatusCardProps) {
  return (
    <AppCard>
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-bold tracking-tight text-ink">{title}</h3>
        {status && statusLabels && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
          >
            {statusLabels[status]}
          </span>
        )}
      </div>

      {facts && facts.length > 0 && (
        <dl className="mt-4 space-y-2">
          {facts.map((fact) => (
            <div key={fact.label} className="flex items-baseline justify-between gap-4 text-sm">
              <dt className="text-ink-label">{fact.label}</dt>
              <dd className="break-all text-right font-mono font-medium text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="mt-3 text-xs leading-relaxed text-ink-faint">{note}</p>}

      <div className="mt-4 flex flex-wrap gap-4 border-t border-edge-soft pt-3">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-ink underline decoration-edge-field underline-offset-4 transition-colors hover:decoration-ink"
          >
            {link.label} ↗
          </a>
        ))}
      </div>
    </AppCard>
  )
}
