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
    <div className="flex items-start justify-between mb-8">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 shrink-0 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <svg
              className="w-6 h-6 text-gray-300"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 16l5-5 4 4 3-3 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="8.5" cy="8.5" r="1.5" />
            </svg>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{eventName}</h1>
          <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        </div>
      </div>
      <PublishedPill isPublished={isPublished} publishedString={publishedLabel} unpublishedString={draftLabel} />
    </div>
  )
}
