'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Chip } from '@heroui/react'
import { CreateTenantModal } from './create-tenant-modal'
import { setTenantActive } from '../actions'

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
          <h1 className="text-2xl font-semibold text-gray-900">Tenants</h1>
          <Button color="primary" onPress={() => setModalOpen(true)}>
            Create tenant
          </Button>
        </div>

        {tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-20 text-center">
            <svg
              className="mb-4 h-12 w-12 text-gray-300"
              viewBox="0 0 48 48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="8" y="8" width="32" height="32" rx="4" />
              <line x1="16" y1="24" x2="32" y2="24" />
              <line x1="24" y1="16" x2="24" y2="32" />
            </svg>
            <p className="text-base font-medium text-gray-900 mb-1">No tenants yet</p>
            <p className="text-sm text-gray-500 mb-6">Create a tenant to get started.</p>
            <Button color="primary" onPress={() => setModalOpen(true)}>
              Create tenant
            </Button>
          </div>
        ) : (
          <Table isStriped aria-label="Tenants">
            <TableHeader>
              <TableColumn>Tenant</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn>Tier</TableColumn>
              <TableColumn>Actions</TableColumn>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link href={`/admin/${tenant.id}`} className="font-medium text-gray-900 hover:underline">
                      {tenant.name}
                    </Link>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{tenant.slug}</p>
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" color={tenant.is_active ? 'success' : 'default'} variant="flat">
                      {tenant.is_active ? 'Active' : 'Inactive'}
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
                      {tenant.is_active ? 'Deactivate' : 'Activate'}
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
