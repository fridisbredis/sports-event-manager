import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'

export type SurfaceSwitchTarget = {
  href: string
  label: string
  Icon: LucideIcon
}

interface Props {
  links: SurfaceSwitchTarget[]
}

// The strip above the official and participant screens that moves a user to
// their other surfaces in the same tenant: "Admin view" and "My race" above
// the official screens, "My shifts" above the participant screens.
//
// One strip holding every link side by side, not one strip per link: an
// admin who is also an official and a participant used to get two full-width
// grey bars stacked on top of each other. Not a tab in the bottom bar: these
// switch surface rather than sit beside the screens below.
//
// Each link is passed only after the caller passes that surface's access
// check (hasAdminScreens / hasParticipantScreens / hasOfficialScreens), so it
// never leads to a 404.
export function SurfaceSwitchBar({ links }: Props) {
  if (links.length === 0) return null

  return (
    <nav className="flex justify-center divide-x divide-edge border-b border-edge bg-gray-50">
      {links.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-w-0 items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
        >
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">{label}</span>
          <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        </Link>
      ))}
    </nav>
  )
}
