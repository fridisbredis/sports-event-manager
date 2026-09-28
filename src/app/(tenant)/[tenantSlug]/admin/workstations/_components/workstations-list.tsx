'use client'

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
import { AppCard } from '@/components/ui/app-card'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { LinkButton } from '@/components/ui/link-button'
import { useTranslation } from '@/lib/i18n/client'
import { workAreaColor, workAreaDotColor } from '@/lib/theme/work-area-colors'

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

function utcTimeStr(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })
}

function formatWindow(w: OperatingWindow): string {
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    })

  const startDay = utcDateStr(w.window_start)
  const endDay = utcDateStr(w.window_end)
  const startTime = utcTimeStr(w.window_start)
  const endTime = utcTimeStr(w.window_end)

  if (startDay !== endDay) {
    return `${dateLabel(w.window_start)} · ${startTime} – ${dateLabel(w.window_end)} · ${endTime}`
  }
  return `${dateLabel(w.window_start)} · ${startTime}–${endTime}`
}

function formatWindowsSummary(windows: OperatingWindow[]): string {
  if (windows.length === 0) return '—'
  if (windows.length === 1) return formatWindow(windows[0])

  const days = new Set(windows.map((w) => utcDateStr(w.window_start)))
  const slots = new Set(
    windows.map((w) => `${utcTimeStr(w.window_start)}–${utcTimeStr(w.window_end)}`)
  )

  if (windows.length === days.size * slots.size) {
    const slotList = [...slots].join(', ')
    return days.size === 1 ? slotList : `${slotList} · ${days.size} days`
  }

  return `${formatWindow(windows[0])} +${windows.length - 1}`
}

function formatStageDate(stage: Stage): string {
  if (!stage.start_time) return ''
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }
  const start = new Date(stage.start_time).toLocaleDateString('en-GB', opts)
  if (!stage.end_time) return start
  const startDay = utcDateStr(stage.start_time)
  const endDay = utcDateStr(stage.end_time)
  if (startDay === endDay) {
    const startTime = utcTimeStr(stage.start_time)
    const endTime = utcTimeStr(stage.end_time)
    return `${start} · ${startTime}–${endTime}`
  }
  const end = new Date(stage.end_time).toLocaleDateString('en-GB', opts)
  return `${start} – ${end}`
}

function StageTitle({ stage, count }: { stage: Stage; count: number }) {
  const { t } = useTranslation('admin')
  const typeLabel =
    stage.stage_type === 'race' ? t('eventConfig.stageTypeRace') : t('eventConfig.stageTypeNonRace')
  const dateStr = formatStageDate(stage)

  return (
    <div className="flex w-full items-center gap-3">
      <span className="text-[17px] font-bold tracking-tight text-ink">{stage.name}</span>
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
      {dateStr && <span className="text-[14px] text-ink-muted">{dateStr}</span>}
      <span className="ml-auto text-[14px] text-ink-muted">
        {t('workstations.workAreaCount', { count })}
      </span>
    </div>
  )
}

function StageContent({
  stage,
  workstations,
  tenantSlug,
}: {
  stage: Stage
  workstations: Workstation[]
  tenantSlug: string
}) {
  const router = useRouter()
  const { t } = useTranslation('admin')
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
                        style={{ backgroundColor: workAreaDotColor(workAreaColor(ws.id)) }}
                      />
                      {ws.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-[15px] text-ink-soft">
                    {formatWindowsSummary(windows)}
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

  if (stages.length === 0) {
    return (
      <div>
        <h1 className="page-title mb-6">{t('workstations.title')}</h1>
        <AppCard bodyClassName="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="mb-4 h-12 w-12 text-gray-300"
            viewBox="0 0 48 48"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="8" y="8" width="32" height="32" rx="2" />
            <line x1="8" y1="8" x2="40" y2="40" />
            <line x1="40" y1="8" x2="8" y2="40" />
          </svg>
          <p className="text-base font-medium text-gray-900 mb-1">{t('workstations.noStages')}</p>
          <p className="text-sm text-gray-500 mb-6">{t('workstations.noStagesHint')}</p>
          <Button variant="bordered" onPress={() => router.push(`/${tenantSlug}/admin/event`)}>
            {t('workstations.goToEventConfig')}
          </Button>
        </AppCard>
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
        itemClasses={{
          base: `${CARD_SURFACE} px-6 py-1`,
          trigger: 'py-4',
          content: 'pb-4 pt-0',
        }}
        className="gap-4 px-0"
      >
        {stages.map((stage) => (
          <AccordionItem
            key={stage.id}
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
            />
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}
