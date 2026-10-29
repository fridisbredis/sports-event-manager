'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ClipboardList, TriangleAlert } from 'lucide-react'
import {
  Chip,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Checkbox,
  SelectItem,
} from '@heroui/react'

import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form-fields'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { useTranslation } from '@/lib/i18n/client'
import { toastError, toastSuccess, extractErrorMessage } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { formatEnteredPhoneForDisplay } from '@/lib/phone'

import { importParticipants, addParticipant, type StageImportOutcome } from '../actions'
import { useAdminEventPath } from '@/lib/hooks/use-admin-event-path'

export interface ParticipantRow {
  id: string
  name: string | null
  bib: string | null
  category: string | null
  club: string | null
  nation: string | null
  gender: string | null
  phone: string | null
  source: string
  extra: Record<string, string>
  withdrawnAt: string | null
  stageIds: string[]
}

export interface StageOption {
  id: string
  name: string
  hasResultsLink: boolean
}

interface Props {
  tenantSlug: string
  tenantId: string
  participants: ParticipantRow[]
  stages: StageOption[]
  page: number
  hasMore: boolean
  selectedStageId: string | null
  showWithdrawn: boolean
}

export default function ParticipantsList({
  tenantSlug,
  tenantId,
  participants,
  stages,
  page,
  hasMore,
  selectedStageId,
  showWithdrawn,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const eventPath = useAdminEventPath()

  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [outcomes, setOutcomes] = useState<StageImportOutcome[] | null>(null)
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()

  const importableStages = stages.filter((s) => s.hasResultsLink)

  // Filters are URL state, not component state: a filtered roster stays
  // filtered across a refresh and can be linked to, and the page itself
  // re-queries rather than filtering a page's worth of rows in the browser
  // (which would silently filter only the current page).
  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(window.location.search)
    if (value === null) params.delete(key)
    else params.set(key, value)
    // Any filter change invalidates the current page number.
    params.delete('page')
    router.push(eventPath(`participants?${params.toString()}`))
  }

  function runImport() {
    startTransition(async () => {
      try {
        const result = await importParticipants({
          tenantSlug,
          tenantId,
          stageIds: selectedStages,
        })

        if (result.error) {
          toastError(result.error)
          return
        }

        setOutcomes(result.outcomes ?? [])
        router.refresh()
      } catch (err) {
        logger.error('Participant import failed', err)
        toastError(extractErrorMessage(err, t('participants.import.genericError')))
      }
    })
  }

  function submitAdd(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await addParticipant({
          tenantSlug,
          tenantId,
          name: String(formData.get('name') ?? ''),
          bib: String(formData.get('bib') ?? ''),
          category: String(formData.get('category') ?? ''),
          club: String(formData.get('club') ?? ''),
          nation: String(formData.get('nation') ?? ''),
          gender: String(formData.get('gender') ?? ''),
          phone: String(formData.get('phone') ?? ''),
        })

        if (result.error) {
          toastError(result.error)
          return
        }

        setAddOpen(false)
        toastSuccess(t('participants.add.success'))
        router.refresh()
      } catch (err) {
        logger.error('Adding a participant failed', err)
        toastError(extractErrorMessage(err, t('participants.add.genericError')))
      }
    })
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">{t('participants.title')}</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="bordered" onPress={() => setAddOpen(true)}>
            {t('participants.add.button')}
          </Button>
          <Button
            color="primary"
            onPress={() => {
              setOutcomes(null)
              setSelectedStages(importableStages.map((s) => s.id))
              setImportOpen(true)
            }}
          >
            {t('participants.import.button')}
          </Button>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <Select
          label={t('participants.filters.stage')}
          selectedKeys={[selectedStageId ?? 'all']}
          className="max-w-xs"
          onChange={(e) => setParam('stage', e.target.value === 'all' ? null : e.target.value)}
        >
          {[
            <SelectItem key="all">{t('participants.filters.allStages')}</SelectItem>,
            ...stages.map((s) => <SelectItem key={s.id}>{s.name}</SelectItem>),
          ]}
        </Select>

        <Checkbox
          isSelected={showWithdrawn}
          onValueChange={(checked) => setParam('withdrawn', checked ? '1' : null)}
          classNames={{ label: 'text-[15px] text-ink-soft' }}
        >
          {t('participants.filters.showWithdrawn')}
        </Checkbox>
      </div>

      {participants.length === 0 ? (
        <EmptyStateCard
          Icon={ClipboardList}
          title={t('participants.empty.title')}
          description={t('participants.empty.description')}
        >
          <Button
            color="primary"
            isDisabled={importableStages.length === 0}
            onPress={() => {
              setOutcomes(null)
              setSelectedStages(importableStages.map((s) => s.id))
              setImportOpen(true)
            }}
          >
            {t('participants.import.button')}
          </Button>
        </EmptyStateCard>
      ) : (
        <Table
          aria-label={t('participants.title')}
          // Same treatment as the officials roster and the system-admin
          // tenant list: the shared card surface, the theme accent line, and
          // a rule between rows that stops before the card's own edge.
          classNames={{
            wrapper: `${CARD_SURFACE} p-4 card-accent-primary`,
            th: 'bg-status-neutral-bg text-[14px] font-medium text-ink-soft first:rounded-l-lg last:rounded-r-lg',
            tr: 'border-b border-edge-soft last:border-b-0',
            td: 'py-4',
          }}
        >
          <TableHeader>
            <TableColumn>{t('participants.columns.bib')}</TableColumn>
            <TableColumn>{t('participants.columns.name')}</TableColumn>
            <TableColumn>{t('participants.columns.category')}</TableColumn>
            <TableColumn>{t('participants.columns.club')}</TableColumn>
            <TableColumn>{t('participants.columns.nation')}</TableColumn>
            <TableColumn>{t('participants.columns.gender')}</TableColumn>
            <TableColumn>{t('participants.columns.phone')}</TableColumn>
            <TableColumn>{t('participants.columns.stages')}</TableColumn>
          </TableHeader>
          <TableBody>
            {participants.map((p) => (
              <TableRow key={p.id} className={p.withdrawnAt ? 'opacity-60' : undefined}>
                <TableCell className="text-[15px] tabular-nums text-ink-soft">
                  {p.bib ?? '—'}
                </TableCell>
                <TableCell className="text-[15px] font-medium text-ink">
                  <span className="flex flex-wrap items-center gap-2">
                    {p.name ?? '—'}
                    {p.withdrawnAt && (
                      <Chip
                        size="sm"
                        variant="flat"
                        className="bg-status-pending-bg text-status-pending-text"
                      >
                        {t('participants.withdrawn')}
                      </Chip>
                    )}
                    {p.source === 'manual' && (
                      <Chip
                        size="sm"
                        variant="flat"
                        className="bg-status-neutral-bg text-status-neutral-text"
                      >
                        {t('participants.manual')}
                      </Chip>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-[15px] text-ink-soft">{p.category ?? '—'}</TableCell>
                <TableCell className="text-[15px] text-ink-soft">{p.club ?? '—'}</TableCell>
                <TableCell className="text-[15px] text-ink-soft">{p.nation ?? '—'}</TableCell>
                <TableCell className="text-[15px] text-ink-soft">{p.gender ?? '—'}</TableCell>
                {/* Always shown, empty until filled: Race Results does not
                    expose phone numbers, so an imported row has none until
                    someone links it. */}
                <TableCell className="text-[15px] text-ink-soft">
                  {/* Free text, not normalised on save — hence not
                      formatPhoneForDisplay, which assumes the stored E.164. */}
                  {p.phone ? formatEnteredPhoneForDisplay(p.phone) : '—'}
                </TableCell>
                <TableCell className="text-[15px] text-ink-soft">
                  {p.stageIds.length === 0
                    ? '—'
                    : stages
                        .filter((s) => p.stageIds.includes(s.id))
                        .map((s) => s.name)
                        .join(', ')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {(page > 1 || hasMore) && (
        <nav
          className="mt-6 flex items-center justify-between"
          aria-label={t('participants.pagination')}
        >
          <Button
            variant="bordered"
            isDisabled={page <= 1}
            onPress={() => setParam('page', String(page - 1))}
          >
            {t('participants.previous')}
          </Button>
          <span className="text-[14px] text-ink-faint">{t('participants.page', { page })}</span>
          <Button
            variant="bordered"
            isDisabled={!hasMore}
            onPress={() => setParam('page', String(page + 1))}
          >
            {t('participants.next')}
          </Button>
        </nav>
      )}

      <Modal
        isOpen={importOpen}
        onOpenChange={setImportOpen}
        size="lg"
        classNames={{
          base: 'bg-white rounded-card shadow-modal',
          backdrop: 'bg-ink/45',
          header: 'px-6 pb-2 pt-6 font-display text-xl font-extrabold tracking-tight text-ink',
          body: 'px-6',
          footer: 'gap-3 px-6 pb-6 pt-4',
          closeButton: 'right-4 top-4 text-ink-label hover:bg-status-neutral-bg',
        }}
      >
        <ModalContent>
          <ModalHeader>{t('participants.import.title')}</ModalHeader>
          <ModalBody>
            {outcomes ? (
              // The per-stage report. Shown instead of a single summary
              // because the import runs one stage per request against an
              // API that can fail for one stage and not another.
              <ul className="flex flex-col gap-2">
                {outcomes.map((o) => (
                  // A tinted status row per stage rather than a line of
                  // text. The outcome is the whole point of this view, and
                  // on a white sheet an edge-soft border (#EEF0F3) is
                  // effectively invisible — it read as unstyled.
                  <li
                    key={o.stageId}
                    className={`flex gap-3 rounded-lg border px-4 py-3 ${
                      o.ok
                        ? 'border-status-ok-border bg-status-ok-soft'
                        : 'border-destructive/30 bg-destructive/5'
                    }`}
                  >
                    {o.ok ? (
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-status-ok-dot"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    ) : (
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0 text-destructive"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                    )}
                    <div className="text-[15px]">
                      <span className="font-medium text-ink">{o.stageName}</span>
                      <span
                        className={`block ${o.ok ? 'text-status-ok-text' : 'text-destructive'}`}
                      >
                        {o.ok
                          ? t('participants.import.summary', {
                              inserted: o.inserted ?? 0,
                              updated: o.updated ?? 0,
                              withdrawn: o.withdrawn ?? 0,
                              revived: o.revived ?? 0,
                            })
                          : o.error}
                      </span>
                      {/* Rows the API returned without a usable ID.
                          Surfaced rather than silently dropped — a short
                          list that looks plausible is the F-REL-10 failure
                          mode. */}
                      {o.ok && o.skipped ? (
                        <span className="block text-ink-label">
                          {t('participants.import.skipped', { count: o.skipped })}
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : importableStages.length === 0 ? (
              <p className="text-[15px] text-ink-soft">
                {t('participants.import.noStagesWithLink')}
              </p>
            ) : (
              <div>
                <p className="mb-4 text-[15px] text-ink-soft">
                  {t('participants.import.explanation')}
                </p>
                {/* One stage per row. Laid out as inline siblings before, so
                    a stage name ran straight into the next stage's box. */}
                <ul className="divide-y divide-edge-soft rounded-lg border border-edge">
                  {stages.map((s) => (
                    <li key={s.id} className="px-4 py-3">
                      <Checkbox
                        isSelected={selectedStages.includes(s.id)}
                        isDisabled={!s.hasResultsLink}
                        onValueChange={(checked) =>
                          setSelectedStages((prev) =>
                            checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                          )
                        }
                        classNames={{ base: 'w-full max-w-full', label: 'w-full' }}
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="text-[15px] text-ink">{s.name}</span>
                          {!s.hasResultsLink && (
                            <Chip
                              size="sm"
                              variant="flat"
                              className="bg-status-neutral-bg text-status-neutral-text"
                            >
                              {t('participants.import.noLinkChip')}
                            </Chip>
                          )}
                        </span>
                      </Checkbox>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="bordered" onPress={() => setImportOpen(false)}>
              {outcomes ? t('participants.import.close') : t('participants.import.cancel')}
            </Button>
            {!outcomes && (
              <Button
                color="primary"
                isLoading={isPending}
                isDisabled={selectedStages.length === 0}
                onPress={runImport}
              >
                {t('participants.import.confirm')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={addOpen}
        onOpenChange={setAddOpen}
        size="lg"
        classNames={{
          base: 'bg-white rounded-card shadow-modal',
          backdrop: 'bg-ink/45',
          header: 'px-6 pb-2 pt-6 font-display text-xl font-extrabold tracking-tight text-ink',
          body: 'px-6',
          footer: 'gap-3 px-6 pb-6 pt-4',
          closeButton: 'right-4 top-4 text-ink-label hover:bg-status-neutral-bg',
        }}
      >
        <ModalContent>
          <form action={submitAdd}>
            <ModalHeader>{t('participants.add.title')}</ModalHeader>
            <ModalBody className="flex flex-col gap-3">
              <Input name="name" label={t('participants.columns.name')} isRequired />
              <Input name="bib" label={t('participants.columns.bib')} />
              <Input name="category" label={t('participants.columns.category')} />
              <Input name="club" label={t('participants.columns.club')} />
              <Input name="nation" label={t('participants.columns.nation')} maxLength={3} />
              <Input name="gender" label={t('participants.columns.gender')} />
              <Input
                name="phone"
                label={t('participants.columns.phone')}
                description={t('participants.add.phoneHint')}
              />
            </ModalBody>
            <ModalFooter>
              <Button variant="bordered" onPress={() => setAddOpen(false)}>
                {t('participants.add.cancel')}
              </Button>
              <Button type="submit" color="primary" isLoading={isPending}>
                {t('participants.add.confirm')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </div>
  )
}
