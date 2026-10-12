import { getServerTranslation } from '@/lib/i18n/server'
import { getUserLanguage } from '@/lib/i18n/user-language'
import { ScheduleSkeleton } from './_components/schedule-skeleton'

// Shown while the schedule renders on the server.
//
// This file is what makes a day change feel like it did something. Without it
// the route is dynamic and prefetching is skipped entirely, so a tap sat on
// the previous day's shifts for the whole round trip with nothing moving —
// the screen read as unresponsive, which is exactly what it was. With it,
// Next partially prefetches the route and swaps this in on the tap.
//
// It mirrors the page's own frame rather than blanking the screen: same
// padding, same header row, same two-option view toggle and day strip at the
// same heights. Only the shift list below is replaced, so the chrome stays
// put and the day's shifts drop into a layout that has not moved.
export default async function Loading() {
  const t = await getServerTranslation(await getUserLanguage(), 'official')

  return (
    <div className="px-5 pt-10 pb-6">
      {/* The title is real text, not a placeholder bar: it is the same on
          every day of every schedule, so rendering it as a grey rectangle
          would hide something already known and make the swap flicker. */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="page-title">{t('mySchedule.title')}</h1>
        <span className="rounded-full border border-edge px-3 py-1 text-sm font-medium text-ink-faint">
          {t('mySchedule.scheduleOwner')}
        </span>
      </div>

      {/* The view toggle and the day strip, at their rendered heights. Both
          are interactive in the real page and inert here, so they are drawn
          as plain surfaces rather than controls a tap would do nothing with.

          Plain divs, not HeroUI's <Skeleton>: importing anything from the
          '@heroui/react' barrel pulls its provider chain into this file, and
          that chain calls createContext, which a server component cannot do.
          The shimmer lives in ScheduleSkeleton below, which is a client
          component and can afford it. */}
      <div aria-hidden="true" className="mb-6 h-[42px] rounded-large bg-surface" />
      <div aria-hidden="true" className="mb-6 flex gap-2">
        {[0, 1, 2, 3, 4].map((tab) => (
          <div key={tab} className="h-[34px] w-[88px] shrink-0 rounded-full bg-surface" />
        ))}
      </div>

      <ScheduleSkeleton label={t('mySchedule.loadingDay')} />
    </div>
  )
}
