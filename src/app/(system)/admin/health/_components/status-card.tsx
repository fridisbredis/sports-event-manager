import { AppCard } from '@/components/ui/app-card'

type Status = 'ok' | 'error' | 'unknown'

const STATUS_STYLES: Record<Status, string> = {
  ok: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
  unknown: 'bg-gray-100 text-gray-600',
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
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {status && statusLabels && (
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
          >
            {statusLabels[status]}
          </span>
        )}
      </div>

      {facts && facts.length > 0 && (
        <dl className="mt-3 space-y-1">
          {facts.map((fact) => (
            <div key={fact.label} className="flex justify-between text-sm">
              <dt className="text-gray-500">{fact.label}</dt>
              <dd className="text-gray-900 font-medium">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="mt-3 text-xs text-gray-500">{note}</p>}

      <div className="mt-4 flex flex-wrap gap-3 border-t border-gray-100 pt-3">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
          >
            {link.label} ↗
          </a>
        ))}
      </div>
    </AppCard>
  )
}
