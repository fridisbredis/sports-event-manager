import { PublishedPill } from './published-pill'

interface DashboardHeaderProps {
  logoUrl: string | null
  eventName: string
  subtitle: string
  isPublished: boolean
  publishedLabel: string
  draftLabel: string
}

export function DashboardHeader({
  logoUrl,
  eventName,
  subtitle,
  isPublished,
  publishedLabel,
  draftLabel,
}: DashboardHeaderProps) {
  return (
    <div className="mb-6 flex items-start justify-between border-b border-edge pb-5">
      <div className="flex items-center gap-4">
        {/* With no logo the tile is a filled theme-gradient plate rather than
            an empty grey box — it reads as the event's mark either way. */}
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-card-sm border-edge"
          style={
            logoUrl
              ? undefined
              : {
                  backgroundImage:
                    'linear-gradient(135deg, hsl(var(--tenant-primary)), hsl(var(--tenant-secondary)))',
                }
          }
        >
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg
              className="h-6 w-6 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 16l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="8.5" r="1.5" />
            </svg>
          )}
        </div>
        <div>
          <h1 className="page-title">{eventName}</h1>
          <p className="mt-1.5 text-[14.5px] text-ink-muted">{subtitle}</p>
        </div>
      </div>
      <PublishedPill
        isPublished={isPublished}
        publishedString={publishedLabel}
        unpublishedString={draftLabel}
      />
    </div>
  )
}
