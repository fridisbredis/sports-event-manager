'use client'

import { Building2 } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
} from '@heroui/react'
import { Button } from '@/components/ui/button'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CreateTenantModal } from './create-tenant-modal'
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
      <div className="p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="page-title">{t('systemAdmin.tenants')}</h1>
          <div className="flex items-center gap-4">
            <Link href="/admin/health" className="text-sm text-blue-600 hover:underline">
              {t('systemAdmin.systemStatus')}
            </Link>
            <Button color="primary" onPress={() => setModalOpen(true)}>
              {t('systemAdmin.createTenant')}
            </Button>
          </div>
        </div>

        {tenants.length === 0 ? (
          <EmptyStateCard
            Icon={Building2}
            title={t('systemAdmin.noTenantsYet')}
            description={t('systemAdmin.noTenantsHint')}
          >
            <Button color="primary" onPress={() => setModalOpen(true)}>
              {t('systemAdmin.createTenant')}
            </Button>
          </EmptyStateCard>
        ) : (
          <Table
            aria-label={t('systemAdmin.tenants')}
            classNames={{
              // Same treatment as the officials roster: the shared card
              // surface plus the theme accent line. The accent class carries a
              // doubled selector so it outranks the `shadow-small` HeroUI's
              // wrapper sets on this element.
              wrapper: `${CARD_SURFACE} p-4 card-accent-primary`,
              th: 'bg-status-neutral-bg text-[14px] font-medium text-ink-soft first:rounded-l-lg last:rounded-r-lg',
              td: 'py-4',
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
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {tenant.name}
                    </Link>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{tenant.slug}</p>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" color={tenant.is_active ? 'success' : 'default'} variant="flat">
                      {tenant.is_active ? t('systemAdmin.active') : t('systemAdmin.inactive')}
                    </Chip>
                  </TableCell>
                  <TableCell className="capitalize text-gray-500">{tenant.tier}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="light"
                      isLoading={pending === tenant.id}
                      onPress={() => handleToggleActive(tenant)}
                    >
                      {tenant.is_active ? t('systemAdmin.deactivate') : t('systemAdmin.activate')}
                    </Button>
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
