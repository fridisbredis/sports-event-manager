'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronRight, ClipboardList, MoreHorizontal, TriangleAlert } from 'lucide-react'
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
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/react'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/confirm-dialog'
import { Input, Select, LISTBOX_ITEM } from '@/components/ui/form-fields'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { useTranslation } from '@/lib/i18n/client'
import { toastError, toastSuccess, extractErrorMessage } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { formatEnteredPhoneForDisplay, formatPhoneForDisplay } from '@/lib/phone'
import { dateLocaleFor, EVENT_TIME_ZONE } from '@/lib/i18n/date-locale'

import {
  importParticipants,
  addParticipant,
  setParticipantHidden,
  removeParticipant,
  unlinkParticipant,
  keepCurrentClaimant,
  switchToNewClaimant,
  type StageImportOutcome,
} from '../actions'
import { useAdminEventPath } from '@/lib/hooks/use-admin-event-path'

import { PremiumBadge } from '@/components/ui/premium-badge'

import type { IceContact } from '@/lib/ice-contact'
import type { ClaimCounts, ClaimFilter, ClaimStatus } from '@/lib/participants/claim-status'

import { IceContactSection } from '../../../../_components/ice-contact-section'
import { ClaimLinkActions } from './claim-link-actions'

/** Bib, Name, Class, Club, Nation, Gender, Phone, Claim status, Stages, ⋯ */
const COLUMN_COUNT = 10

// Columns drop out as the screen narrows, so Bib and Name always have room
// (same approach as the officials roster's HIDE_ON_MOBILE). On a phone the
// row is Bib, Name and the ⋯ menu; the rest comes back from sm/md/lg up.
const SHOW_FROM_SM = 'hidden sm:table-cell'
const SHOW_FROM_MD = 'hidden md:table-cell'
const SHOW_FROM_LG = 'hidden lg:table-cell'

/** Header buttons: full width in a two-column grid on a phone, natural width from sm. */
const HEADER_BUTTON = 'w-full sm:w-auto'

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
  hiddenAt: string | null
  /** N41: participants.user_id is set. The id itself never reaches the browser. */
  claimed: boolean
  /** N42: unclaimed / claimed / conflict (claimed with someone waiting). */
  claimStatus: ClaimStatus
  /** When the current claimant claimed; null for an unclaimed row. */
  claimedAt: string | null
  /** N42: verified claimants waiting for Keep current / Switch to new, oldest first. */
  pendingClaims: PendingClaim[]
  stageIds: string[]
}

export interface PendingClaim {
  /** The conflict row's id, which Switch to new takes. */
  id: string
  /** E.164 without '+', SMS-verified. */
  phone: string | null
  triedAt: string
}

const CLAIM_STATUS_CHIP: Record<ClaimStatus, string> = {
  unclaimed: 'bg-status-neutral-bg text-status-neutral-text',
  claimed: 'bg-status-ok-bg text-status-ok-text',
  conflict: 'bg-status-pending-bg text-status-pending-text',
}

export interface StageOption {
  id: string
  name: string
  hasResultsLink: boolean
}

interface Props {
  tenantSlug: string
  tenantId: string
  eventId: string
  participants: ParticipantRow[]
  stages: StageOption[]
  page: number
  hasMore: boolean
  selectedStageId: string | null
  showWithdrawn: boolean
  showHidden: boolean
  claimFilter: ClaimFilter
  /** Null when the count could not be read; the header then leaves it out. */
  claimCounts: ClaimCounts | null
  /** N41: ICE contacts of claimed rows on this page, keyed by participant id. */
  iceContacts: Record<string, IceContact>
  claimList: { path: string; eventName: string; isOpen: boolean }
}

export default function ParticipantsList({
  tenantSlug,
  tenantId,
  eventId,
  participants,
  stages,
  page,
  hasMore,
  selectedStageId,
  showWithdrawn,
  showHidden,
  claimFilter,
  claimCounts,
  iceContacts,
  claimList,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const eventPath = useAdminEventPath()

  const [importOpen, setImportOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [outcomes, setOutcomes] = useState<StageImportOutcome[] | null>(null)
  const [selectedStages, setSelectedStages] = useState<string[]>([])
  const [isPending, startTransition] = useTransition()
  const [removeTarget, setRemoveTarget] = useState<ParticipantRow | null>(null)
  // The row whose hide/remove is in flight, so only its ⋯ button spins.
  const [rowPendingId, setRowPendingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [unlinkTarget, setUnlinkTarget] = useState<ParticipantRow | null>(null)
  // N42: Switch to new asks first — someone loses access. Keep current does
  // not: nobody's access changes.
  const [switchTarget, setSwitchTarget] = useState<{
    participant: ParticipantRow
    claim: PendingClaim
  } | null>(null)

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
          eventId,
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

  async function toggleHidden(participant: ParticipantRow) {
    const hide = participant.hiddenAt === null
    const name = participant.name ?? '—'
    setRowPendingId(participant.id)
    try {
      const result = await setParticipantHidden({
        tenantSlug,
        tenantId,
        eventId,
        participantId: participant.id,
        hidden: hide,
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      toastSuccess(
        t(hide ? 'participants.actions.hideSuccess' : 'participants.actions.unhideSuccess', {
          name,
        })
      )
      router.refresh()
    } catch (err) {
      logger.error('Hiding a participant failed', err)
      toastError(extractErrorMessage(err, t('participants.actions.genericError')))
    } finally {
      setRowPendingId(null)
    }
  }

  async function confirmRemove() {
    if (!removeTarget) return
    const target = removeTarget
    setRemoveTarget(null)
    setRowPendingId(target.id)
    try {
      const result = await removeParticipant({
        tenantSlug,
        tenantId,
        eventId,
        participantId: target.id,
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      toastSuccess(t('participants.actions.removeSuccess', { name: target.name ?? '—' }))
      router.refresh()
    } catch (err) {
      logger.error('Removing a participant failed', err)
      toastError(extractErrorMessage(err, t('participants.actions.genericError')))
    } finally {
      setRowPendingId(null)
    }
  }

  async function confirmUnlink() {
    if (!unlinkTarget) return
    const target = unlinkTarget
    setUnlinkTarget(null)
    setRowPendingId(target.id)
    try {
      const result = await unlinkParticipant({
        tenantSlug,
        tenantId,
        eventId,
        participantId: target.id,
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      toastSuccess(t('participants.claim.unlinkSuccess', { name: target.name ?? '—' }))
      router.refresh()
    } catch (err) {
      logger.error('Unlinking a participant failed', err)
      toastError(extractErrorMessage(err, t('participants.actions.genericError')))
    } finally {
      setRowPendingId(null)
    }
  }

  async function keepCurrent(participant: ParticipantRow) {
    setRowPendingId(participant.id)
    try {
      const result = await keepCurrentClaimant({
        tenantSlug,
        tenantId,
        eventId,
        participantId: participant.id,
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      toastSuccess(t('participants.conflict.keepSuccess', { name: participant.name ?? '—' }))
      router.refresh()
    } catch (err) {
      logger.error('Keeping the current claimant failed', err)
      toastError(extractErrorMessage(err, t('participants.actions.genericError')))
    } finally {
      setRowPendingId(null)
    }
  }

  async function confirmSwitch() {
    if (!switchTarget) return
    const { participant, claim } = switchTarget
    setSwitchTarget(null)
    setRowPendingId(participant.id)
    try {
      const result = await switchToNewClaimant({
        tenantSlug,
        tenantId,
        eventId,
        conflictId: claim.id,
      })
      if (result.error) {
        toastError(result.error)
        return
      }
      toastSuccess(t('participants.conflict.switchSuccess', { name: participant.name ?? '—' }))
      router.refresh()
    } catch (err) {
      logger.error('Switching the claimant failed', err)
      toastError(extractErrorMessage(err, t('participants.actions.genericError')))
    } finally {
      setRowPendingId(null)
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="page-title">{t('participants.title')}</h1>
          <PremiumBadge label={t('dashboard.premiumBadge')} />
        </div>
        {/* On a phone: Import, then Add, each the full width (the labels are
            too long for half a 320px screen), then the claim link pair side
            by side. From sm: one row, in reading order, primary last. */}
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
          <ClaimLinkActions
            claimPath={claimList.path}
            eventName={claimList.eventName}
            buttonClassName={`${HEADER_BUTTON} order-3 sm:order-none`}
          />
          <Button
            variant="bordered"
            className={`${HEADER_BUTTON} col-span-2 order-2 sm:order-none`}
            onPress={() => setAddOpen(true)}
          >
            {t('participants.add.button')}
          </Button>
          <Button
            color="primary"
            className={`${HEADER_BUTTON} col-span-2 order-1 sm:order-none`}
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

      {/* PB6: the link and QR code work in every state, the list behind
          them only once the participant side is open (N36). Said here so a
          printed QR code showing "not available" is not a surprise. */}
      {!claimList.isOpen && (
        <p
          className="mb-6 rounded-lg border border-edge bg-status-neutral-bg px-4 py-3 text-sm text-ink-soft"
          role="note"
        >
          {t('participants.claimLink.closedNotice')}
        </p>
      )}

      {/* N41 (L25): how many have claimed, then the claim-status filter.
          The count is the whole start list, not this page or this filter —
          the same figure EVT-01 shows (fetchClaimCounts). */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        {claimCounts && (
          <p className="flex flex-wrap items-center gap-x-3 text-[15px] font-medium text-ink">
            {t('participants.claim.count', {
              claimed: claimCounts.claimed,
              total: claimCounts.total,
            })}
            {claimCounts.conflicts > 0 && (
              <span className="inline-flex items-center gap-1 text-status-pending-text">
                <TriangleAlert className="size-4" strokeWidth={2.2} aria-hidden="true" />
                {t('participants.conflict.count', { count: claimCounts.conflicts })}
              </span>
            )}
          </p>
        )}
        <ClaimFilterTabs
          value={claimFilter}
          onChange={(next) => setParam('claim', next === 'all' ? null : next)}
        />
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

        <Checkbox
          isSelected={showHidden}
          onValueChange={(checked) => setParam('hidden', checked ? '1' : null)}
          classNames={{ label: 'text-[15px] text-ink-soft' }}
        >
          {t('participants.filters.showHidden')}
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
            <TableColumn className={SHOW_FROM_SM}>{t('participants.columns.category')}</TableColumn>
            <TableColumn className={SHOW_FROM_LG}>{t('participants.columns.club')}</TableColumn>
            <TableColumn className={SHOW_FROM_LG}>{t('participants.columns.nation')}</TableColumn>
            <TableColumn className={SHOW_FROM_LG}>{t('participants.columns.gender')}</TableColumn>
            <TableColumn className={SHOW_FROM_MD}>{t('participants.columns.phone')}</TableColumn>
            <TableColumn>{t('participants.columns.claimStatus')}</TableColumn>
            <TableColumn className={SHOW_FROM_MD}>{t('participants.columns.stages')}</TableColumn>
            {/* Same ⋯ column as the officials roster (N27): narrow,
                right-aligned, labelled only for screen readers. */}
            <TableColumn width={64} align="end">
              <span className="sr-only">{t('participants.actions.column')}</span>
            </TableColumn>
          </TableHeader>
          <TableBody>
            {participants.flatMap((p) => {
              const isExpanded = expanded.has(p.id)
              // Same two-row pattern as OFF-01: the roster row, and the
              // detail panel beneath it only while open. An array, not a
              // fragment, because HeroUI's TableBody reads its children as a
              // collection.
              return [
                <TableRow
                  key={p.id}
                  className={p.withdrawnAt || p.hiddenAt ? 'opacity-60' : undefined}
                >
                  <TableCell className="text-[15px] tabular-nums text-ink-soft">
                    {p.bib ?? '—'}
                  </TableCell>
                  <TableCell className="text-[15px] font-medium text-ink">
                    {/* The name is the disclosure control, as on OFF-01: a
                      wide target, and the row stays inert so the ⋯ menu's
                      clicks are not swallowed by it. */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(p.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`participant-detail-${p.id}`}
                      className="flex w-full flex-wrap items-center gap-2 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tenant-primary"
                    >
                      <ChevronRight
                        className={`size-4 shrink-0 text-ink-faint transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
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
                      {p.hiddenAt && (
                        <Chip
                          size="sm"
                          variant="flat"
                          className="bg-status-neutral-bg text-status-neutral-text"
                        >
                          {t('participants.hidden')}
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
                    </button>
                  </TableCell>
                  <TableCell className={`${SHOW_FROM_SM} text-[15px] text-ink-soft`}>
                    {p.category ?? '—'}
                  </TableCell>
                  <TableCell className={`${SHOW_FROM_LG} text-[15px] text-ink-soft`}>
                    {p.club ?? '—'}
                  </TableCell>
                  <TableCell className={`${SHOW_FROM_LG} text-[15px] text-ink-soft`}>
                    {p.nation ?? '—'}
                  </TableCell>
                  <TableCell className={`${SHOW_FROM_LG} text-[15px] text-ink-soft`}>
                    {p.gender ?? '—'}
                  </TableCell>
                  {/* Always shown, empty until filled: Race Results does not
                    expose phone numbers, so an imported row has none until
                    someone links it. */}
                  <TableCell className={`${SHOW_FROM_MD} text-[15px] text-ink-soft`}>
                    {/* Free text, not normalised on save — hence not
                      formatPhoneForDisplay, which assumes the stored E.164. */}
                    {p.phone ? formatEnteredPhoneForDisplay(p.phone) : '—'}
                  </TableCell>
                  <TableCell>
                    <Chip size="sm" variant="flat" className={CLAIM_STATUS_CHIP[p.claimStatus]}>
                      {t(`participants.claim.${p.claimStatus}`)}
                    </Chip>
                  </TableCell>
                  <TableCell className={`${SHOW_FROM_MD} text-[15px] text-ink-soft`}>
                    {p.stageIds.length === 0
                      ? '—'
                      : stages
                          .filter((s) => p.stageIds.includes(s.id))
                          .map((s) => s.name)
                          .join(', ')}
                  </TableCell>
                  <TableCell>
                    <ParticipantActionsMenu
                      participant={p}
                      busy={rowPendingId === p.id}
                      t={t}
                      onToggleHidden={() => toggleHidden(p)}
                      onRemove={() => setRemoveTarget(p)}
                    />
                  </TableCell>
                </TableRow>,
                ...(isExpanded
                  ? [
                      <TableRow key={`${p.id}-detail`}>
                        {/* One cell spanning every column, and the row's only
                          cell: React Stately throws unless a row's colSpans
                          add up to the column count (see OFF-01). */}
                        <TableCell
                          colSpan={COLUMN_COUNT}
                          id={`participant-detail-${p.id}`}
                          className="bg-status-neutral-bg/40 p-0"
                        >
                          <ParticipantDetailPanel
                            participant={p}
                            ice={iceContacts[p.id] ?? null}
                            busy={rowPendingId === p.id}
                            onUnlink={() => setUnlinkTarget(p)}
                            onKeepCurrent={() => keepCurrent(p)}
                            onSwitch={(claim) => setSwitchTarget({ participant: p, claim })}
                          />
                        </TableCell>
                      </TableRow>,
                    ]
                  : []),
              ]
            })}
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

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('participants.actions.removeConfirmTitle')}
        body={t('participants.actions.removeConfirmBody', { name: removeTarget?.name ?? '—' })}
        cancelLabel={t('participants.actions.cancel')}
        confirmLabel={t('participants.actions.remove')}
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={confirmRemove}
      />

      <ConfirmDialog
        open={unlinkTarget !== null}
        title={t('participants.claim.unlinkConfirmTitle')}
        body={t('participants.claim.unlinkConfirmBody', { name: unlinkTarget?.name ?? '—' })}
        cancelLabel={t('participants.actions.cancel')}
        confirmLabel={t('participants.claim.unlink')}
        destructive
        onCancel={() => setUnlinkTarget(null)}
        onConfirm={confirmUnlink}
      />

      <ConfirmDialog
        open={switchTarget !== null}
        title={t('participants.conflict.switchConfirmTitle')}
        body={t('participants.conflict.switchConfirmBody', {
          name: switchTarget?.participant.name ?? '—',
          phone: switchTarget?.claim.phone ? formatPhoneForDisplay(switchTarget.claim.phone) : '—',
        })}
        cancelLabel={t('participants.actions.cancel')}
        confirmLabel={t('participants.conflict.switch')}
        onCancel={() => setSwitchTarget(null)}
        onConfirm={confirmSwitch}
      />
    </div>
  )
}

/**
 * N41/N42 (L25): All / Unclaimed / Claimed / Conflict. A segmented control
 * like SCHED-01's view toggle — one either/or choice. Claimed includes the
 * conflict rows (they are claimed, see claim-status.ts); Conflict narrows to
 * the ones waiting for a decision.
 */
function ClaimFilterTabs({
  value,
  onChange,
}: {
  value: ClaimFilter
  onChange: (value: ClaimFilter) => void
}) {
  const { t } = useTranslation('admin')
  const options: Array<[ClaimFilter, string]> = [
    ['all', t('participants.claim.filterAll')],
    ['unclaimed', t('participants.claim.unclaimed')],
    ['claimed', t('participants.claim.claimed')],
    ['conflict', t('participants.claim.conflict')],
  ]

  return (
    <div
      role="tablist"
      aria-label={t('participants.claim.filterLabel')}
      className="inline-flex gap-1 rounded-control bg-status-neutral-bg p-1"
    >
      {options.map(([key, label]) => {
        const isActive = value === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={`rounded-[7px] px-4 py-1.5 text-sm font-semibold transition-colors ${
              isActive ? 'bg-tenant-primary text-white shadow-card' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * N41: a participant's expanded row (PART-01 row-expanded-claimed).
 *
 * ICE first for a claimed row — it is what someone opens the row for in a
 * hurry (R5c, L27). Then the Race Results fields the columns have no room
 * for. Unlink last, on its own, and only for a claimed row: it asks first.
 *
 * N42 (conflict-row-expanded): a row in conflict opens on the decision —
 * current claimant, the waiting claimant(s), Keep current / Switch to new —
 * and offers no Unlink: the decision is the way out of a conflict.
 */
function ParticipantDetailPanel({
  participant,
  ice,
  busy,
  onUnlink,
  onKeepCurrent,
  onSwitch,
}: {
  participant: ParticipantRow
  ice: IceContact | null
  busy: boolean
  onUnlink: () => void
  onKeepCurrent: () => void
  onSwitch: (claim: PendingClaim) => void
}) {
  const { t } = useTranslation('admin')
  const extra = Object.entries(participant.extra).filter(([, v]) => v !== '' && v != null)
  const inConflict = participant.claimStatus === 'conflict'

  return (
    <div className="flex flex-col gap-5 px-4 pb-5 pt-1">
      {inConflict && (
        <ClaimConflictSection
          participant={participant}
          busy={busy}
          onKeepCurrent={onKeepCurrent}
          onSwitch={onSwitch}
        />
      )}
      <div className="grid gap-6 sm:grid-cols-2">
        {participant.claimed ? (
          <IceContactSection ice={ice} />
        ) : (
          <section>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
              {t('officials.detailIce')}
            </h3>
            <p className="text-[14px] text-ink-soft">{t('participants.claim.iceNotClaimed')}</p>
          </section>
        )}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
            {t('participants.detail.otherFields')}
          </h3>
          {extra.length === 0 ? (
            <p className="text-[14px] text-ink-soft">{t('participants.detail.noOtherFields')}</p>
          ) : (
            <dl className="space-y-1.5 text-[14px]">
              {extra.map(([key, value]) => (
                <div key={key} className="flex gap-3">
                  <dt className="w-32 shrink-0 break-words text-ink-soft">{key}</dt>
                  <dd className="text-ink">{String(value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>
      </div>
      {participant.claimed && !inConflict && (
        <div>
          <Button variant="bordered" color="danger" size="sm" isLoading={busy} onPress={onUnlink}>
            {t('participants.claim.unlink')}
          </Button>
        </div>
      )}
    </div>
  )
}

// Claim times are real instants: shown in the event's zone, so the server
// pass and hydration agree (same rule as COMM-01).
function formatClaimTime(iso: string, language?: string): string {
  return new Date(iso).toLocaleString(dateLocaleFor(language), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: EVENT_TIME_ZONE,
  })
}

/**
 * N42 (L11, L18): who holds the record and who else says it is theirs. The
 * admin has called them outside the app; this is where the answer goes in.
 *
 * Several waiting claimants are each listed with their own Switch button
 * (Frida 2026-11-10: every verified claimant is kept). Keep current dismisses
 * all of them. Neither choice sends an SMS — said under the buttons, since an
 * admin would otherwise reasonably expect one.
 */
function ClaimConflictSection({
  participant,
  busy,
  onKeepCurrent,
  onSwitch,
}: {
  participant: ParticipantRow
  busy: boolean
  onKeepCurrent: () => void
  onSwitch: (claim: PendingClaim) => void
}) {
  const { t, i18n } = useTranslation('admin')
  const single = participant.pendingClaims.length === 1

  return (
    <section
      aria-label={t('participants.conflict.heading')}
      className="rounded-lg border border-status-pending-text/25 bg-white p-4"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
            {t('participants.conflict.current')}
          </h3>
          <dl className="space-y-1.5 text-[14px]">
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-ink-soft">{t('participants.columns.phone')}</dt>
              <dd className="text-ink">
                {participant.phone ? formatEnteredPhoneForDisplay(participant.phone) : '—'}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-ink-soft">
                {t('participants.conflict.claimedAt')}
              </dt>
              <dd className="tabular-nums text-ink">
                {participant.claimedAt
                  ? formatClaimTime(participant.claimedAt, i18n.language)
                  : '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
            {single ? t('participants.conflict.new') : t('participants.conflict.newSeveral')}
          </h3>
          <ul className="flex flex-col gap-3">
            {participant.pendingClaims.map((claim) => (
              <li key={claim.id} className="flex flex-wrap items-end justify-between gap-3">
                <dl className="space-y-1.5 text-[14px]">
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 text-ink-soft">
                      {t('participants.columns.phone')}
                    </dt>
                    <dd className="text-ink">
                      {claim.phone ? formatPhoneForDisplay(claim.phone) : '—'}
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="w-24 shrink-0 text-ink-soft">
                      {t('participants.conflict.triedAt')}
                    </dt>
                    <dd className="tabular-nums text-ink">
                      {formatClaimTime(claim.triedAt, i18n.language)}
                    </dd>
                  </div>
                </dl>
                {!single && (
                  <Button
                    variant="bordered"
                    size="sm"
                    isDisabled={busy}
                    onPress={() => onSwitch(claim)}
                  >
                    {t('participants.conflict.switchToThis')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="bordered" size="sm" isLoading={busy} onPress={onKeepCurrent}>
          {t('participants.conflict.keep')}
        </Button>
        {single && (
          <Button
            color="primary"
            size="sm"
            isDisabled={busy}
            onPress={() => onSwitch(participant.pendingClaims[0])}
          >
            {t('participants.conflict.switch')}
          </Button>
        )}
      </div>
      <p className="mt-3 text-[13px] text-ink-label">{t('participants.conflict.noSms')}</p>
    </section>
  )
}

/**
 * N34: a participant row's actions behind one ⋯ button, as on the officials
 * roster.
 *
 * Hide is offered for every row and is reversible, so it needs no
 * confirmation. Remove is offered only for a row added by hand — Peter
 * answered for those; the imported list belongs to Race Results, and a
 * removed imported row would come back on the next import anyway. It sits
 * last, under a divider, and asks first, because it cannot be undone.
 */
function ParticipantActionsMenu({
  participant,
  busy,
  t,
  onToggleHidden,
  onRemove,
}: {
  participant: ParticipantRow
  busy: boolean
  t: ReturnType<typeof useTranslation>['t']
  onToggleHidden: () => void
  onRemove: () => void
}) {
  const isHidden = participant.hiddenAt !== null
  const isManual = participant.source === 'manual'
  const label = t('participants.actions.menuFor', { name: participant.name ?? '—' })

  // Built as an array: HeroUI's DropdownMenu reads its children as a
  // collection, and a `false` from a conditional would not be a valid item.
  const items = [
    isHidden ? (
      <DropdownItem key="toggleHidden" showDivider={isManual}>
        {t('participants.actions.unhide')}
      </DropdownItem>
    ) : (
      // The description answers the question an admin will have: does
      // hiding take them out of the race? It does not (Peter, N26).
      <DropdownItem
        key="toggleHidden"
        showDivider={isManual}
        description={t('participants.actions.hideDescription')}
      >
        {t('participants.actions.hide')}
      </DropdownItem>
    ),
    ...(isManual
      ? [
          <DropdownItem key="remove" className="text-destructive" color="danger">
            {t('participants.actions.remove')}
          </DropdownItem>,
        ]
      : []),
  ]

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button isIconOnly variant="light" size="sm" isLoading={busy} aria-label={label}>
          <MoreHorizontal className="size-5 text-ink-soft" aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={label}
        itemClasses={{ base: LISTBOX_ITEM }}
        onAction={(key) => {
          if (key === 'toggleHidden') onToggleHidden()
          else if (key === 'remove') onRemove()
        }}
      >
        {items}
      </DropdownMenu>
    </Dropdown>
  )
}
