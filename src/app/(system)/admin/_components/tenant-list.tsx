'use client'

import { useState } from 'react'
import Link from 'next/link'
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
          <button
            onClick={() => setModalOpen(true)}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            Create tenant
          </button>
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
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
            >
              Create tenant
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Tenant
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Tier
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/${tenant.id}`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        {tenant.name}
                      </Link>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{tenant.slug}</p>
                    </td>
                    <td className="px-4 py-3">
                      {tenant.is_active ? (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 capitalize">{tenant.tier}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActive(tenant)}
                        disabled={pending === tenant.id}
                        className="text-sm text-gray-600 hover:text-gray-900 underline underline-offset-2 disabled:opacity-50"
                      >
                        {pending === tenant.id
                          ? '…'
                          : tenant.is_active
                            ? 'Deactivate'
                            : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateTenantModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}
