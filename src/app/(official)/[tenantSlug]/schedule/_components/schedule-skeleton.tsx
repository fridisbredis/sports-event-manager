import { SkeletonRows } from '../../_components/skeleton-rows'

// Stands in for the day's shifts while a day is fetched.
//
// Shaped like the thing it replaces rather than a spinner: a time gutter and
// a row of cards, at the same widths and heights as the real rows in
// schedule-view, so the content lands in place instead of pushing the screen
// around as it arrives. Three rows is a typical day on this screen — enough
// to read as "shifts are coming", not so many that a one-shift day visibly
// collapses.
//
// The gutter is what distinguishes this from every other tab's placeholder:
// the schedule is the only one that puts a time column beside its cards.
//
// No 'use client' needed here — SkeletonRows carries it, and this file adds
// only a prop.
export function ScheduleSkeleton({ label }: { label: string }) {
  return <SkeletonRows label={label} rows={3} gutter />
}
