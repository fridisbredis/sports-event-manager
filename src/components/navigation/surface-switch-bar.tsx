import Link from 'next/link'
import { type LucideIcon } from 'lucide-react'

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
// Soft chips on the page's own white, not a grey band split by dividers: the
// band read as a system toolbar bolted on above the app, and it took more
// attention than a way out to another surface should. No outward arrow either
// — these are links within the app, and ↗ says "opens somewhere else".
//
// Each link is passed only after the caller passes that surface's access
// check (hasAdminScreens / hasParticipantScreens / hasOfficialScreens), so it
// never leads to a 404.
export function SurfaceSwitchBar({ links }: Props) {
  if (links.length === 0) return null

  return (
    <nav className="flex flex-wrap justify-end gap-2 px-5 pt-4">
      {links.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-w-0 items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-gray-100 hover:text-ink"
        >
          <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span className="truncate">{label}</span>
        </Link>
      ))}
    </nav>
  )
}
