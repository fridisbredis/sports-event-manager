import Link from 'next/link'
import { ArrowUpRight, type LucideIcon } from 'lucide-react'

interface Props {
  href: string
  label: string
  Icon: LucideIcon
}

// N43: the strip that moves a user who is both official and participant
// between their two surfaces — "My race" above the official screens, "My
// shifts" above the participant screens. Same look as AdminViewLink, and for
// the same reason: it is a surface switch, not a peer of the tabs below.
//
// Rendered only for callers who pass the other surface's access check
// (hasParticipantScreens / hasOfficialScreens), so it never leads to a 404.
export function SurfaceSwitchLink({ href, label, Icon }: Props) {
  return (
    <div className="border-b border-edge bg-gray-50">
      <Link
        href={href}
        className="flex items-center justify-center gap-1.5 px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:text-ink"
      >
        <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="truncate">{label}</span>
        <ArrowUpRight className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </div>
  )
}
