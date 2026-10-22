import { formatMoney } from '@/lib/i18n/date-locale'
import type { SmsCapStatus } from '@/lib/sms/cap'

/**
 * One tenant's SMS spend this month, on the system-admin tenant page (N24).
 *
 * Sits directly below the feature tier, because the tier is what sets the
 * cap: a system admin who has just moved a tenant between tiers sees what
 * that did to its allowance without going anywhere else.
 *
 * Fuller than the tenant-list column, which has to stay scannable across
 * rows. Here there is room for the segment count, which is the figure that
 * actually explains the spend — kronor are derived from it, and an operator
 * reconciling against a Twilio invoice needs the segments rather than the
 * conversion.
 *
 * A server component: nothing here is interactive, and the figures come from
 * the page's own read.
 */

interface Props {
  usage: SmsCapStatus | null
  language: string
  title: string
  spentLabel: string
  capLabel: string
  segmentsLabel: string
  statusLabel: string
  blockedHint: string
  unavailableHint: string
  estimateHint?: string
}

export function TenantSmsSection({
  usage,
  language,
  title,
  spentLabel,
  capLabel,
  segmentsLabel,
  statusLabel,
  blockedHint,
  unavailableHint,
  estimateHint,
}: Props) {
  return (
    <div className="p-6">
      <h2 className="section-label mb-4">{title}</h2>

      {/* Usage unreadable: say so rather than render zeroes, which would be
          indistinguishable from a tenant that has sent nothing. */}
      {!usage ? (
        <p className="text-sm text-ink-label">{unavailableHint}</p>
      ) : (
        <>
          <dl className="space-y-2">
            <Row label={spentLabel}>
              <span
                className={
                  usage.exceeded
                    ? 'font-semibold text-destructive'
                    : usage.fraction >= 0.8
                      ? 'font-semibold text-status-pending-text'
                      : 'text-ink'
                }
              >
                {formatMoney(usage.spentAmount, language)}
              </span>
            </Row>
            <Row label={capLabel}>
              <span className="text-ink">{formatMoney(usage.capAmount, language)}</span>
            </Row>
            {/* The billable unit. Kronor are derived from this, so anyone
                checking a figure against Twilio needs it rather than the
                conversion. */}
            <Row label={segmentsLabel}>
              <span className="text-ink">{usage.segments}</span>
            </Row>
          </dl>

          <p className="mt-3 text-sm text-ink-label">
            {usage.exceeded ? blockedHint : statusLabel}
          </p>

          {estimateHint && <p className="mt-2 text-xs text-ink-faint">{estimateHint}</p>}
        </>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-ink-label">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{children}</dd>
    </div>
  )
}
