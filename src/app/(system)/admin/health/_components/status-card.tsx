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

interface StatusCardFact {
  label: string
  value: string
  /** Turns the value into a link to the thing it describes — e.g. a failed
   *  workflow run, so the log is one click away rather than a hunt through
   *  the Actions tab. Plain text when omitted. */
  href?: string
  /** Tints the value red when the fact itself is the bad news, so a failed
   *  row is findable without reading every value. Cards whose facts are
   *  neutral readings (a project ref, an SMS count) leave this off. */
  tone?: 'default' | 'error'
}

interface StatusCardProps {
  title: string
  status?: Status
  statusLabels?: Record<Status, string>
  facts?: StatusCardFact[]
  links: StatusCardLink[]
  note?: string
}

export function StatusCard({ title, status, statusLabels, facts, links, note }: StatusCardProps) {
  return (
    <AppCard>
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-display text-base font-bold tracking-tight text-ink">{title}</h3>
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
          {facts.map((fact) => {
            const valueClass = `break-all text-right font-mono font-medium ${
              fact.tone === 'error' ? 'text-destructive' : 'text-ink'
            }`
            return (
              <div key={fact.label} className="flex items-baseline justify-between gap-4 text-sm">
                <dt className="text-ink-label">{fact.label}</dt>
                <dd className={valueClass}>
                  {fact.href ? (
                    <a
                      href={fact.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline decoration-edge-field underline-offset-4 transition-colors hover:decoration-current"
                    >
                      {fact.value}
                    </a>
                  ) : (
                    fact.value
                  )}
                </dd>
              </div>
            )
          })}
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
