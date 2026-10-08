'use client'

import { MapPin } from 'lucide-react'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Accordion,
  AccordionItem,
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
} from '@heroui/react'
import { Button } from '@/components/ui/button'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import {
  WORK_AREA_COLORS,
  workAreaColorMap,
  workAreaDotColor,
  type WorkAreaColor,
} from '@/lib/theme/work-area-colors'
import { dateLocaleFor } from '@/lib/i18n/date-locale'
import { useLanguage } from '@/components/i18n-provider'

// Every rendered id is in the map by construction; this only satisfies the
// type at the lookup site.
const FALLBACK_COLOR: WorkAreaColor = WORK_AREA_COLORS[0]

interface OperatingWindow {
  window_start: string
  window_end: string
}

interface Stage {
  id: string
  name: string
  stage_type: string
  start_time: string | null
  end_time: string | null
}

interface Workstation {
  id: string
  name: string
  /** Palette name chosen by an admin; null falls back to hashing the id. */
  color: string | null
  capacity_ceiling: number
  stage_id: string | null
  workstation_operating_windows: OperatingWindow[]
}

interface Props {
  tenantSlug: string
  stages: Stage[]
  workstations: Workstation[]
}

function utcDateStr(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

// `language` threads down from the components' useLanguage() so these
// module-level helpers name weekdays and months in the language of the text
// around them; the date format itself is regional either way.
function utcTimeStr(iso: string, language?: string): string {
  return new Date(iso).toLocaleTimeString(dateLocaleFor(language), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function formatWindow(w: OperatingWindow, language?: string): string {
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(dateLocaleFor(language), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })

  const startDay = utcDateStr(w.window_start)
  const endDay = utcDateStr(w.window_end)
  const startTime = utcTimeStr(w.window_start, language)
  const endTime = utcTimeStr(w.window_end, language)

  if (startDay !== endDay) {
    return `${dateLabel(w.window_start)} · ${startTime} – ${dateLabel(w.window_end)} · ${endTime}`
  }
  return `${dateLabel(w.window_start)} · ${startTime}–${endTime}`
}

function formatWindowsSummary(windows: OperatingWindow[], language?: string): string {
  if (windows.length === 0) return '—'
  if (windows.length === 1) return formatWindow(windows[0], language)

  const days = new Set(windows.map((w) => utcDateStr(w.window_start)))
  const slots = new Set(
    windows.map(
      (w) => `${utcTimeStr(w.window_start, language)}–${utcTimeStr(w.window_end, language)}`
    )
  )

  if (windows.length === days.size * slots.size) {
    const slotList = [...slots].join(', ')
    return days.size === 1 ? slotList : `${slotList} · ${days.size} days`
  }

  return `${formatWindow(windows[0], language)} +${windows.length - 1}`
}

function formatStageDate(stage: Stage, language?: string): string {
  if (!stage.start_time) return ''
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }
  const start = new Date(stage.start_time).toLocaleDateString(dateLocaleFor(language), opts)
  if (!stage.end_time) return start
  const startDay = utcDateStr(stage.start_time)
  const endDay = utcDateStr(stage.end_time)
  if (startDay === endDay) {
    const startTime = utcTimeStr(stage.start_time, language)
    const endTime = utcTimeStr(stage.end_time, language)
    return `${start} · ${startTime}–${endTime}`
  }
  const end = new Date(stage.end_time).toLocaleDateString(dateLocaleFor(language), opts)
  return `${start} – ${end}`
}

function StageTitle({ stage, count }: { stage: Stage; count: number }) {
  const { t } = useTranslation('admin')
  const language = useLanguage()
  const typeLabel =
    stage.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')
  const dateStr = formatStageDate(stage, language)

  return (
    <div className="flex w-full items-center gap-3">
      <span className="font-display text-[17px] font-bold tracking-tight text-ink">
        {stage.name}
      </span>
      <Chip
        size="sm"
        variant="flat"
        className={
          stage.stage_type === 'race'
            ? 'bg-tenant-accent-tint font-medium text-tenant-accent-tint-text'
            : 'bg-status-neutral-bg font-medium text-status-neutral-text'
        }
      >
        {typeLabel}
      </Chip>
      {/* HeroUI renders an AccordionItem's title inside an <h2>, and the
          base layer puts Manrope on every h1-h3. These two are body text, so
          they have to ask for the system stack back explicitly. */}
      {dateStr && <span className="font-sans text-[13px] text-ink-muted">{dateStr}</span>}
      <span className="ml-auto font-sans text-[13px] text-ink-muted">
        {t('workstations.workAreaCount', { count })}
      </span>
    </div>
  )
}

function StageContent({
  stage,
  workstations,
  tenantSlug,
  colors,
}: {
  stage: Stage
  workstations: Workstation[]
  tenantSlug: string
  colors: Map<string, WorkAreaColor>
}) {
  const router = useRouter()
  const { t } = useTranslation('admin')
  const language = useLanguage()
  const count = workstations.length

  return (
    <div>
      {count > 0 && (
        <Table
          removeWrapper
          aria-label={stage.name}
          classNames={{
            // A single tinted header band and plain white rows, per the
            // reference — striping fights the per-row colour dots.
            th: 'bg-status-neutral-bg text-[14px] font-medium text-ink-soft first:rounded-l-lg last:rounded-r-lg',
            td: 'py-4',
          }}
        >
          <TableHeader>
            <TableColumn>{t('workstations.nameLabel')}</TableColumn>
            <TableColumn>{t('workstations.colOperatingWindows')}</TableColumn>
            <TableColumn align="end">{t('workstations.colCapacity')}</TableColumn>
          </TableHeader>
          <TableBody>
            {workstations.map((ws) => {
              const windows = ws.workstation_operating_windows ?? []
              return (
                <TableRow
                  key={ws.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/${tenantSlug}/admin/workstations/${ws.id}`)}
                >
                  <TableCell className="text-[15px] font-medium text-ink">
                    <span className="flex items-center gap-2.5">
                      {/* Decorative only — the name beside it already
                          identifies the row, so the dot carries no meaning of
                          its own and is hidden from assistive tech. */}
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          backgroundColor: workAreaDotColor(colors.get(ws.id) ?? FALLBACK_COLOR),
                        }}
                      />
                      {ws.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-[15px] text-ink-soft">
                    {formatWindowsSummary(windows, language)}
                  </TableCell>
                  <TableCell className="text-right text-[15px] text-ink-soft">
                    {t('workstations.upTo', { n: ws.capacity_ceiling })}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      <div className="mt-2 flex justify-end border-t border-edge pt-3">
        <LinkButton
          onPress={() => router.push(`/${tenantSlug}/admin/workstations/new?stageId=${stage.id}`)}
        >
          + {t('workstations.addWorkArea')}
        </LinkButton>
      </div>
    </div>
  )
}

export default function WorkstationsList({ tenantSlug, stages, workstations }: Props) {
  const router = useRouter()
  const { t } = useTranslation('admin')

  // Colour across every work area in the tenant, not per stage: the same
  // colour appearing in two stage panels reads as a repeat just as much as
  // two in one table would. Must sit above the early return below — hooks
  // cannot be called conditionally.
  const colors = useMemo(
    () => workAreaColorMap(workstations.map((ws) => ({ id: ws.id, color: ws.color }))),
    [workstations]
  )

  if (stages.length === 0) {
    return (
      <div>
        <h1 className="page-title mb-6">{t('workstations.title')}</h1>
        <EmptyStateCard
          Icon={MapPin}
          title={t('workstations.noStages')}
          description={t('workstations.noStagesHint')}
        >
          <Button variant="bordered" onPress={() => router.push(`/${tenantSlug}/admin/event`)}>
            {t('workstations.goToEventConfig')}
          </Button>
        </EmptyStateCard>
      </div>
    )
  }

  return (
    <div>
      <h1 className="page-title mb-6">{t('workstations.title')}</h1>
      <Accordion
        variant="splitted"
        defaultExpandedKeys={stages.map((s) => s.id)}
        // HeroUI's splitted variant ships its own card look; point it at the
        // shared surface so these panels match every other card in the app.
        // `card-accent-primary` adds the same faint top accent the officials
        // roster and the dashboard cards carry.
        itemClasses={{
          base: `${CARD_SURFACE} card-accent-primary px-6 py-1`,
          trigger: 'py-4',
          content: 'pb-4 pt-0',
        }}
        className="gap-4 px-0"
      >
        {stages.map((stage) => (
          <AccordionItem
            key={stage.id}
            // The title is a component, not a string, so HeroUI can't derive a
            // label for screen readers or keyboard typeahead on its own.
            textValue={stage.name}
            title={
              <StageTitle
                stage={stage}
                count={workstations.filter((ws) => ws.stage_id === stage.id).length}
              />
            }
          >
            <StageContent
              stage={stage}
              workstations={workstations.filter((ws) => ws.stage_id === stage.id)}
              tenantSlug={tenantSlug}
              colors={colors}
            />
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
