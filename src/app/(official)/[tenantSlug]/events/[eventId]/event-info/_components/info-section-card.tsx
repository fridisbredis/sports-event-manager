import Image from 'next/image'
import { ExternalLink } from 'lucide-react'
import { AppCard } from '@/components/ui/app-card'
import {
  type InfoSection,
  infoSectionImageUrl,
  infoSectionLinkText,
} from '@/lib/events/info-sections'

// N38: one organiser-written info section on INFO-01 — Getting there,
// Parking, Depot area, Live video. Title, then text, image and link in that
// order, each only when present (L23 guarantees at least one).
//
// The text is the organiser's own words and is shown exactly as typed: never
// translated, line breaks kept (whitespace-pre-line), so a migrated
// 'Facilities' list of "• label" lines still reads as a list.
export function InfoSectionCard({ section }: { section: InfoSection }) {
  return (
    <AppCard bodyClassName="gap-2 p-4">
      <h2 className="text-[17px] font-bold leading-snug text-ink">{section.title}</h2>

      {section.body ? (
        <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-ink-muted">
          {section.body}
        </p>
      ) : null}

      {/* Width/height give next/image its intrinsic box; h-auto w-full lets
          the real aspect ratio win, so a tall depot sketch and a wide map
          both render uncropped at the card's width. */}
      {section.image_path ? (
        <Image
          src={infoSectionImageUrl(section.image_path)}
          alt={section.title}
          width={1600}
          height={1200}
          sizes="(max-width: 640px) 100vw, 600px"
          className="mt-1 h-auto w-full rounded-xl"
        />
      ) : null}

      {/* Same link treatment as the race-results link on the stage card:
          underline, tenant accent, external glyph, new tab, and noopener for
          a URL the admin typed. */}
      {section.link_url ? (
        <a
          href={section.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1.5 self-start text-[15px] font-medium leading-relaxed text-tenant-primary underline underline-offset-2"
        >
          <span className="min-w-0 break-words">
            {infoSectionLinkText(section.link_url, section.link_label)}
          </span>
          <ExternalLink className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
        </a>
      ) : null}
    </AppCard>
  )
}
