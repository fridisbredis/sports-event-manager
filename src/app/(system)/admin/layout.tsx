import { SidebarNav } from './_components/sidebar-nav'

interface Props {
  children: React.ReactNode
}

export default function SystemAdminLayout({ children }: Props) {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white flex flex-col min-h-screen">
        <div className="px-6 py-5 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
            System admin
          </span>
        </div>
        <SidebarNav />
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}
