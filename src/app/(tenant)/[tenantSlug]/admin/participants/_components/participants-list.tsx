'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Download, Plus } from 'lucide-react'
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

import {
  importParticipants,
  addParticipant,
  type StageImportOutcome,
} from '../actions'

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
    router.push(`/${tenantSlug}/admin/participants?${params.toString()}`)
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('participants.title')}</h1>
          <p className="text-default-500 text-sm">{t('participants.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="bordered"
            startContent={<Plus className="h-4 w-4" />}
            onPress={() => setAddOpen(true)}
          >
            {t('participants.add.button')}
          </Button>
          <Button
            color="primary"
            startContent={<Download className="h-4 w-4" />}
            onPress={() => {
              setOutcomes(null)
              setSelectedStages(importableStages.map((s) => s.id))
              setImportOpen(true)
            }}
          >
            {t('participants.import.button')}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-end gap-3">
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
        >
          {t('participants.filters.showWithdrawn')}
        </Checkbox>
      </div>

      {participants.length === 0 ? (
        <EmptyStateCard
          Icon={Users}
          title={t('participants.empty.title')}
          description={t('participants.empty.description')}
        />
      ) : (
        <div className={CARD_SURFACE}>
          {/* Wide tables get their own horizontal scroll container so the
              page body never scrolls sideways on a phone. */}
          <div className="overflow-x-auto">
            <Table aria-label={t('participants.title')} removeWrapper>
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
                  <TableRow key={p.id} className={p.withdrawnAt ? 'opacity-50' : undefined}>
                    <TableCell>{p.bib ?? '—'}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        {p.name ?? '—'}
                        {p.withdrawnAt && (
                          <Chip size="sm" variant="flat" color="warning">
                            {t('participants.withdrawn')}
                          </Chip>
                        )}
                        {p.source === 'manual' && (
                          <Chip size="sm" variant="flat">
                            {t('participants.manual')}
                          </Chip>
                        )}
                      </span>
                    </TableCell>
                    <TableCell>{p.category ?? '—'}</TableCell>
                    <TableCell>{p.club ?? '—'}</TableCell>
                    <TableCell>{p.nation ?? '—'}</TableCell>
                    <TableCell>{p.gender ?? '—'}</TableCell>
                    {/* Always shown, empty until filled: Race Results does
                        not expose phone numbers, so an imported row has
                        none until someone links it. */}
                    <TableCell>{p.phone ?? '—'}</TableCell>
                    <TableCell>
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
          </div>
        </div>
      )}

      {(page > 1 || hasMore) && (
        <nav className="flex items-center justify-between" aria-label={t('participants.pagination')}>
          <Button
            variant="bordered"
            isDisabled={page <= 1}
            onPress={() => setParam('page', String(page - 1))}
          >
            {t('participants.previous')}
          </Button>
          <span className="text-default-500 text-sm">{t('participants.page', { page })}</span>
          <Button
            variant="bordered"
            isDisabled={!hasMore}
            onPress={() => setParam('page', String(page + 1))}
          >
            {t('participants.next')}
          </Button>
        </nav>
      )}

      <Modal isOpen={importOpen} onOpenChange={setImportOpen} size="2xl">
        <ModalContent>
          <ModalHeader>{t('participants.import.title')}</ModalHeader>
          <ModalBody>
            {outcomes ? (
              // The per-stage report. Shown instead of a single summary
              // because the import runs one stage per request against an
              // API that can fail for one stage and not another.
              <ul className="space-y-2">
                {outcomes.map((o) => (
                  <li key={o.stageId} className="text-sm">
                    <span className="font-medium">{o.stageName}: </span>
                    {o.ok ? (
                      <span>
                        {t('participants.import.summary', {
                          inserted: o.inserted ?? 0,
                          updated: o.updated ?? 0,
                          withdrawn: o.withdrawn ?? 0,
                          revived: o.revived ?? 0,
                        })}
                        {/* Rows the API returned without a usable ID.
                            Surfaced rather than silently dropped — a short
                            list that looks plausible is the F-REL-10
                            failure mode. */}
                        {o.skipped ? ` ${t('participants.import.skipped', { count: o.skipped })}` : ''}
                      </span>
                    ) : (
                      <span className="text-danger">{o.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : importableStages.length === 0 ? (
              <p className="text-sm">{t('participants.import.noStagesWithLink')}</p>
            ) : (
              <div className="space-y-3">
                <p className="text-default-500 text-sm">{t('participants.import.explanation')}</p>
                {stages.map((s) => (
                  <Checkbox
                    key={s.id}
                    isSelected={selectedStages.includes(s.id)}
                    isDisabled={!s.hasResultsLink}
                    onValueChange={(checked) =>
                      setSelectedStages((prev) =>
                        checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                      )
                    }
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      {s.name}
                      {!s.hasResultsLink && (
                        <Chip size="sm" variant="flat">
                          {t('participants.import.noLinkChip')}
                        </Chip>
                      )}
                    </span>
                  </Checkbox>
                ))}
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

      <Modal isOpen={addOpen} onOpenChange={setAddOpen}>
        <ModalContent>
          <form action={submitAdd}>
            <ModalHeader>{t('participants.add.title')}</ModalHeader>
            <ModalBody className="space-y-3">
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
