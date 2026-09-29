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

interface Tenant {
  id: string
  name: string
  slug: string
  is_active: boolean
  tier: string
}

interface Props {
  tenants: Tenant[]
}

export function TenantList({ tenants }: Props) {
  const { t } = useTranslation('admin')
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
      <div className="mx-auto max-w-[1240px] px-10 pb-16 pt-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="page-title">{t('systemAdmin.tenants')}</h1>
          <div className="flex items-center gap-6">
            {/* Graphite, not blue: the system surface carries no tenant theme,
                and the design pairs this with the dark primary button rather
                than making it the one saturated element on the page. */}
            <Link
              href="/admin/health"
              className="text-sm font-medium text-ink transition-colors hover:text-ink-muted"
            >
              {t('systemAdmin.systemStatus')}
            </Link>
            <SystemButton onPress={() => setModalOpen(true)}>
              {t('systemAdmin.createTenant')}
            </SystemButton>
          </div>
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
              <TableColumn>{t('systemAdmin.actionsColumn')}</TableColumn>
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
                  <TableCell>
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
