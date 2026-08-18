'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'

export function SidebarNav() {
  const pathname = usePathname()
  const router = useRouter()
  const isActive = pathname === '/admin' || pathname.startsWith('/admin/')

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

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
      <div className="border-t border-gray-100 py-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 text-left px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
        >
          <LogOut className="size-4 shrink-0" strokeWidth={2} />
          Log out
        </button>
      </div>
    </div>
  )
}
