'use client'

import { Building2 } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@heroui/react'
import { Chip } from '@/components/ui/chip'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CreateTenantModal } from './create-tenant-modal'
import { SystemButton } from './system-button'
import { setTenantActive } from '../actions'
import { useTranslation } from '@/lib/i18n/client'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { formatMoney } from '@/lib/i18n/date-locale'
import type { TenantSmsUsage } from '@/lib/sms/cap'

interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  tier: string
}

interface Props {
  tenants: Tenant[]
  /** N24 month-to-date spend per tenant. Null when usage could not be read —
   *  the column is then hidden rather than showing every tenant at zero,
   *  which would read as a quiet month rather than a failed query. */
  smsUsage: TenantSmsUsage[] | null
}

export function TenantList({ tenants, smsUsage }: Props) {
  const { t, i18n } = useTranslation('admin')
  const language = i18n.language
  const usageById = new Map((smsUsage ?? []).map((u) => [u.tenantId, u]))
  const [modalOpen, setModalOpen] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  async function handleToggleActive(tenant: Tenant) {
    if (pending) return
    setPending(tenant.id)
    await setTenantActive(tenant.id, !tenant.is_active)
    setPending(null)
  }

  return (
    <>
      <div className="mx-auto max-w-[1240px] px-4 pb-16 pt-8 md:px-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="page-title">{t('systemAdmin.tenants')}</h1>
          {/* System status moved to the sidebar: it's a page of its own, not
              an action on this list, and should be reachable from every
              system-admin route. */}
          <SystemButton onPress={() => setModalOpen(true)}>
            {t('systemAdmin.createTenant')}
          </SystemButton>
        </div>

        {tenants.length === 0 ? (
          <EmptyStateCard
            Icon={Building2}
            title={t('systemAdmin.noTenantsYet')}
            description={t('systemAdmin.noTenantsHint')}
            // The shared plate takes the tenant tint, which is undefined on
            // this surface — override it with the same neutral the table
            // header uses so the icon still sits on a plate, not on nothing.
            className="[&>div:first-child]:bg-status-neutral-bg [&>div:first-child]:text-ink-muted"
          >
            <SystemButton onPress={() => setModalOpen(true)}>
              {t('systemAdmin.createTenant')}
            </SystemButton>
          </EmptyStateCard>
        ) : (
          <Table
            aria-label={t('systemAdmin.tenants')}
            // HeroUI's wrapper adds its own shadow-small, which wins over
            // CARD_SURFACE's lighter shadow-card and reads as a heavier border
            // than every other card. Same reason AppCard passes shadow="none".
            shadow="none"
            classNames={{
              wrapper: `${CARD_SURFACE} p-4`,
              th: 'bg-status-neutral-bg text-[14px] font-medium text-ink-soft first:rounded-l-lg last:rounded-r-lg',
              // 58px row min-height from the handoff, via generous cell
              // padding — the design gives this list noticeably more air than
              // a default HeroUI table row.
              td: 'py-5',
              tr: 'border-b border-edge-soft last:border-b-0',
            }}
          >
            <TableHeader>
              <TableColumn>{t('systemAdmin.tenantColumn')}</TableColumn>
              <TableColumn>{t('systemAdmin.statusColumn')}</TableColumn>
              <TableColumn>{t('systemAdmin.tierColumn')}</TableColumn>
              {/* Hidden when usage could not be read at all, rather than
                  rendering a column of blanks that invites the reader to
                  conclude nobody has sent anything. */}
              <TableColumn className={smsUsage === null ? 'hidden' : 'hidden sm:table-cell'}>
                {t('systemAdmin.smsColumn')}
              </TableColumn>
              {/* Hidden below md: four columns is one too many for a phone,
                  and this one is the least useful there — activate/deactivate
                  is also on the tenant's own page, which the name links to, so
                  nothing becomes unreachable. The header and the cell carry
                  the same rule or the two halves of the table misalign. */}
              <TableColumn className="hidden md:table-cell">
                {t('systemAdmin.actionsColumn')}
              </TableColumn>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link
                      href={`/admin/${tenant.id}`}
                      className="font-semibold text-ink hover:underline"
                    >
                      {tenant.name}
                    </Link>
                    <p className="mt-0.5 font-mono text-xs text-ink-faint">{tenant.slug}</p>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      variant="flat"
                      classNames={{
                        base: tenant.is_active ? 'bg-status-ok-bg' : 'bg-status-neutral-bg',
                        content: `font-medium ${
                          tenant.is_active ? 'text-status-ok-text' : 'text-status-neutral-text'
                        }`,
                      }}
                    >
                      {tenant.is_active ? t('systemAdmin.active') : t('systemAdmin.inactive')}
                    </Chip>
                  </TableCell>
                  <TableCell className="capitalize text-ink-muted">{tenant.tier}</TableCell>
                  {/* The column is kept in the DOM and hidden with a class
                      rather than conditionally rendered: HeroUI's Table types
                      its children as a fixed column set, so a conditional
                      element breaks the header/cell pairing. */}
                  <TableCell className={smsUsage === null ? 'hidden' : 'hidden sm:table-cell'}>
                    <TenantSmsCell
                      usage={usageById.get(tenant.id)}
                      language={language}
                      ofLabel={t('systemAdmin.smsOf')}
                      blockedLabel={t('systemAdmin.smsBlocked')}
                    />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <button
                      type="button"
                      disabled={pending === tenant.id}
                      onClick={() => handleToggleActive(tenant)}
                      className="rounded-control text-sm font-semibold text-ink transition-colors hover:text-ink-muted disabled:opacity-50"
                    >
                      {tenant.is_active ? t('systemAdmin.deactivate') : t('systemAdmin.activate')}
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <CreateTenantModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}

/**
 * One tenant's month-to-date SMS spend (N24).
 *
 * The figure is the point, not a meter: a system admin reads this column to
 * spot the one row that needs attention, and three progress bars in a table
 * make that harder rather than easier. Colour carries the signal instead,
 * and only when there is one — ordinary rows stay muted like the tier beside
 * them.
 *
 * "Blocked" is spelled out rather than left to colour alone. It is the one
 * state with a consequence (sending has actually stopped), and a red number
 * says "high" while the word says what happened.
 */
export function TenantSmsCell({
  usage,
  language,
  ofLabel,
  blockedLabel,
}: {
  usage?: TenantSmsUsage
  language: string
  ofLabel: string
  blockedLabel: string
}) {
  // A tenant with no row at all: readAllTenantSmsUsage returns every tenant,
  // so this only happens if the two lists disagree. An em dash rather than
  // "0 kr", which would assert something this cell does not know.
  if (!usage) return <span className="text-ink-faint">—</span>

  const approaching = !usage.exceeded && usage.fraction >= 0.8

  return (
    <div className="whitespace-nowrap">
      <span
        className={`tabular-nums ${
          usage.exceeded
            ? 'font-semibold text-destructive'
            : approaching
              ? 'font-semibold text-status-pending-text'
              : 'text-ink-muted'
        }`}
      >
        {formatMoney(usage.spentAmount, language)}
      </span>
      <span className="text-ink-faint">
        {' '}
        {ofLabel} {formatMoney(usage.capAmount, language)}
      </span>
      {usage.exceeded && (
        <span className="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold text-destructive">
          {blockedLabel}
        </span>
      )}
    </div>
  )
}
