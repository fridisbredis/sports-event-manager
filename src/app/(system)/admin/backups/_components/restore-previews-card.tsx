import Link from 'next/link'
import { AppCard } from '@/components/ui/app-card'

// N25 step 2: one row per tenant with its newest restore preview, if any. The
// preview itself is run in GitHub (the workflow needs a runner with Docker);
// the tenant's id is shown so it can be copied into the run form.

export interface PreviewRow {
  tenantId: string
  name: string
  /** "Previewed 2 hours ago · slot 3, week 47", or null when there is none. */
  previewed: string | null
}

interface Props {
  title: string
  intro: string
  runLabel: string
  runHref: string
  noPreview: string
  openLabel: string
  /** Shown instead of the rows when the previews cannot be listed. */
  unavailable?: string
  rows: PreviewRow[]
}

export function RestorePreviewsCard({
  title,
  intro,
  runLabel,
  runHref,
  noPreview,
  openLabel,
  unavailable,
  rows,
}: Props) {
  return (
    <AppCard>
      <h3 className="font-display text-base font-bold tracking-tight text-ink">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-label">{intro}</p>

      {unavailable ? (
        <p className="mt-4 text-xs leading-relaxed text-ink-faint">{unavailable}</p>
      ) : (
        <ul className="mt-4 divide-y divide-edge-soft">
          {rows.map((row) => (
            <li key={row.tenantId} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                {/* select-all: one tap selects the whole id for the run form. */}
                <p className="select-all truncate font-mono text-xs text-ink-faint">
                  {row.tenantId}
                </p>
                <p className="mt-0.5 text-xs text-ink-label">{row.previewed ?? noPreview}</p>
              </div>
              {row.previewed && (
                <Link
                  href={`/admin/backups/preview/${row.tenantId}`}
                  className="shrink-0 text-sm font-medium text-ink underline decoration-edge-field underline-offset-4 transition-colors hover:decoration-ink"
                >
                  {openLabel}
                  {/* One "Open" per row: the name tells a screen reader which. */}
                  <span className="sr-only"> {row.name}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-edge-soft pt-3">
        <a
          href={runHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-ink underline decoration-edge-field underline-offset-4 transition-colors hover:decoration-ink"
        >
          {runLabel} ↗
        </a>
      </div>
    </AppCard>
  )
}
