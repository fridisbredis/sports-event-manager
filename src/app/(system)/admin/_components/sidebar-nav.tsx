'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function SidebarNav() {
  const pathname = usePathname()
  const isActive = pathname === '/admin' || pathname.startsWith('/admin/')

  return (
    <div className="flex flex-col flex-1">
      <nav className="py-2 flex-1">
        <Link
          href="/admin"
          className={`block px-6 py-2.5 text-sm transition-colors ${
            isActive
              ? 'bg-gray-100 text-gray-900 font-medium'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`}
        >
          Tenants
        </Link>
      </nav>
    </div>
  )
}
