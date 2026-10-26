'use client'

import { Users, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  SelectItem,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/react'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/form-fields'
import { EmptyStateCard } from '@/components/ui/empty-state'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { LISTBOX_ITEM } from '@/components/ui/form-fields'
import { WORK_AREA_COLORS, workAreaColorMap } from '@/lib/theme/work-area-colors'
import { AvatarImage } from '@/components/ui/avatar-image'
import { useTranslation } from '@/lib/i18n/client'
import ConfirmDialog from '@/components/confirm-dialog'
import { toastError, extractErrorMessage, parseRetryAfterMinutes } from '@/lib/toast'
import { logger } from '@/lib/logger'
import {
  isValidPhoneForCountry,
  PHONE_COUNTRIES,
  DEFAULT_PHONE_COUNTRY,
  formatPhoneForDisplay,
} from '@/lib/phone'
import type { OfficialListItem } from '@/types/app'
import type { OfficialDetail } from '@/lib/scheduling/official-detail'
import { formatStageDate, formatStageTime, stageTimeRangeParts } from '@/lib/i18n/stage-range'
import { makeTenantAdmin, removeTenantAdmin } from '../actions'

interface Props {
  tenantSlug: string
  tenantId: string
  officials: OfficialListItem[]
  currentUserId: string
  /** N17: shifts and time off per official id, read server-side. */
  details: Record<string, OfficialDetail>
  /** Drives date and time formatting, which follows the locale setting (B7). */
  language: string
  /** N27: user ids holding tenant_admin in this tenant. */
  adminUserIds: string[]
  /** N27: how many tenant admins the tenant's tier allows. */
  adminCap: number
  /** N27: the tenant's tier, named in the cap explanation. */
  tier: string
}

type AdminRoleChange = { official: OfficialListItem; action: 'make' | 'remove' }

/**
 * Up to two initials for the avatar. Falls back to the first two characters
 * for single-word names and digit-only placeholders (phone numbers show up as
 * names for officials who have not set one yet).
 */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

export default function OfficialsList({
  tenantSlug,
  tenantId,
  officials: initialOfficials,
  currentUserId,
  details,
  language,
  adminUserIds,
  adminCap,
  tier,
}: Props) {
  const { t } = useTranslation('admin')
  const router = useRouter()
  const [officials, setOfficials] = useState<OfficialListItem[]>(initialOfficials)
  // N17: which rows are expanded. A set rather than a single id — comparing
  // two officials' shifts means having both open at once.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<OfficialListItem | null>(null)
  const [resendTarget, setResendTarget] = useState<OfficialListItem | null>(null)
  const [pending, setPending] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const [adminRoleChange, setAdminRoleChange] = useState<AdminRoleChange | null>(null)
  const [adminRolePendingId, setAdminRolePendingId] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_PHONE_COUNTRY)
  // Validation is only shown once the field has been left. Typing a valid
  // number means passing through every invalid prefix of it, so validating on
  // each keystroke marks the field red while the user is still mid-number.
  // Same pattern as the login form (src/app/(auth)/login/page.tsx).
  const [phoneTouched, setPhoneTouched] = useState(false)

  const phoneIsValid = phone.trim() !== '' && isValidPhoneForCountry(phone, phoneCountry)
  const showPhoneError = phoneTouched && phone.trim() !== '' && !phoneIsValid

  async function handleAdd() {
    if (!name.trim() || !phoneIsValid || pending) return
    setPending(true)
    setAddError(null)
    try {
      const res = await fetch('/api/officials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          name: name.trim(),
          phone: phone.trim(),
          phoneCountry,
        }),
      })
      if (res.ok) {
        const { official, smsSent } = await res.json()
        setOfficials((prev) => [...prev, official])
        setName('')
        setPhone('')
        setPhoneCountry(DEFAULT_PHONE_COUNTRY)
        setPhoneTouched(false)
        setAddModalOpen(false)
        // The official exists either way — only the invite SMS can have failed here.
        if (smsSent === false) {
          toastError(t('officials.addedSmsFailed', { name: official.name }))
        }
      } else if (res.status === 409) {
        // Same number as an active official in this tenant. Names may repeat, numbers may not.
        const message = t('officials.duplicatePhone')
        setAddError(message)
        toastError(message)
      } else if (res.status === 400) {
        const message = t('officials.invalidPhone')
        setAddError(message)
        toastError(message)
      } else if (res.status === 401) {
        const message = t('officials.sessionExpired')
        setAddError(message)
        toastError(message)
      } else if (res.status === 429) {
        // Tenant-level invite-attempt ceiling — not a problem with the phone number
        // itself, so this must not populate addError (which drives the phone field's
        // invalid state).
        const minutes = parseRetryAfterMinutes(res)
        toastError(t('officials.addRateLimited', { count: minutes, minutes }))
      } else if (res.status === 503) {
        // The rate-limit check itself failed (DB unavailable) — transient, not a
        // problem with the phone number, so this must not populate addError.
        toastError(t('officials.addServiceUnavailable'))
      } else {
        const body = await res.json().catch(() => ({}))
        logger.error('Unexpected /api/officials error response', undefined, {
          status: res.status,
          message: extractErrorMessage(body, `Error ${res.status}`),
        })
        const message = t('officials.addUnexpectedError')
        setAddError(message)
        toastError(message)
      }
    } finally {
      setPending(false)
    }
  }

  async function handleRemove() {
    if (!removeTarget) return
    setPending(true)
    try {
      const res = await fetch(`/api/officials/${removeTarget.id}?tenantId=${tenantId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setOfficials((prev) => prev.filter((o) => o.id !== removeTarget.id))
        setRemoveTarget(null)
      } else {
        toastError(t('officials.removeError', { name: removeTarget.name }))
      }
    } finally {
      setPending(false)
    }
  }

  async function handleResend(official: OfficialListItem) {
    setResendTarget(null)
    setResendingId(official.id)
    try {
      const res = await fetch(`/api/officials/${official.id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      if (res.status === 502) {
        // Only a 502 (SMS send rejected) happens after the token is rotated, so the
        // official's old invite link is genuinely dead and no new one arrived.
        toastError(t('officials.resendError', { name: official.name }))
      } else if (res.status === 429) {
        // Rate limited before rotation — the existing invite link still works.
        const minutes = parseRetryAfterMinutes(res)
        toastError(t('officials.resendRateLimited', { count: minutes, minutes }))
      } else if (res.status === 401) {
        toastError(t('officials.sessionExpired'))
      } else if (res.status === 503) {
        // The rate-limit check itself failed (DB unavailable) before rotation — the
        // official's existing invite link still works and this is transient.
        toastError(t('officials.resendServiceUnavailable'))
      } else if (res.status === 400 || res.status === 404) {
        toastError(t('officials.resendOfficialUnavailable'))
      } else if (!res.ok) {
        toastError(t('officials.resendConfigError'))
      }
    } finally {
      setResendingId(null)
    }
  }

  async function handleAdminRoleChange(change: AdminRoleChange) {
    setAdminRoleChange(null)
    setAdminRolePendingId(change.official.id)
    try {
      const action = change.action === 'make' ? makeTenantAdmin : removeTenantAdmin
      const result = await action({ tenantSlug, tenantId, officialId: change.official.id })
      if (result.error) toastError(result.error)
      // The admin set and the cap come from the server, so re-read them rather
      // than guessing locally — the RPC may have refused for a reason (the cap,
      // a concurrent change) the client cannot see.
      router.refresh()
    } finally {
      setAdminRolePendingId(null)
    }
  }

  const adminIds = new Set(adminUserIds)
  const visibleOfficials = officials.filter((o) => o.invite_status !== 'removed')
  const adminPlacesUsed = adminUserIds.length
  const adminCapReached = adminPlacesUsed >= adminCap

  // Keyed off the full roster rather than `visibleOfficials`, so removing
  // someone never repaints the avatars of the people who remain.
  const avatarColors = useMemo(() => workAreaColorMap(officials.map((o) => o.id)), [officials])

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function closeAddModal() {
    setAddModalOpen(false)
    setName('')
    setPhone('')
    setPhoneCountry(DEFAULT_PHONE_COUNTRY)
    setPhoneTouched(false)
    setAddError(null)
  }

  // What the admin-role dialog says.
  const adminRoleDialog = adminRoleChange
    ? adminRoleChange.action === 'make'
      ? {
          title: t('officials.makeAdminConfirmTitle'),
          body: t('officials.makeAdminConfirmBody', { name: adminRoleChange.official.name }),
          confirm: t('officials.makeAdmin'),
        }
      : {
          title: t('officials.removeAdminRoleConfirmTitle'),
          body: t('officials.removeAdminRoleConfirmBody', { name: adminRoleChange.official.name }),
          confirm: t('officials.removeAdminRole'),
        }
    : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="page-title">{t('officials.title')}</h1>
        <Button color="primary" onPress={() => setAddModalOpen(true)}>
          {t('officials.add')}
        </Button>
      </div>

      {/* The admin limit, stated before it is hit rather than discovered
          through a greyed-out menu item. */}
      {visibleOfficials.length > 0 && (
        <p className="-mt-3 mb-4 text-sm text-ink-label">
          {t('officials.adminCapHint', {
            count: adminCap,
            used: adminPlacesUsed,
            tier: t(`systemAdmin.${tier}`, { defaultValue: tier }),
          })}
          {adminCapReached && <> {t('officials.adminCapReachedHint')}</>}
        </p>
      )}

      {visibleOfficials.length === 0 ? (
        <EmptyStateCard
          Icon={Users}
          title={t('officials.empty')}
          description={t('officials.emptyHint')}
        >
          <Button color="primary" onPress={() => setAddModalOpen(true)}>
            {t('officials.add')}
          </Button>
        </EmptyStateCard>
      ) : (
        <Table
          aria-label={t('officials.title')}
          classNames={{
            // The shared card surface plus the theme accent line along the
            // top — the same treatment the dashboard and event-config cards
            // get. `card-accent-primary` is defined with a doubled selector so
            // it outranks both CARD_SURFACE's shadow-card and the
            // `shadow-small` HeroUI's wrapper sets on this same element.
            wrapper: `${CARD_SURFACE} p-4 card-accent-primary`,
            th: 'bg-status-neutral-bg text-[14px] font-medium text-ink-soft first:rounded-l-lg last:rounded-r-lg',
            // A rule between officials, dropped on the last row so the list
            // doesn't end on a line just above the card's own edge. Same
            // treatment as the system-admin tenant list.
            tr: 'border-b border-edge-soft last:border-b-0',
            td: 'py-4',
          }}
        >
          <TableHeader>
            <TableColumn>{t('officials.name')}</TableColumn>
            <TableColumn>{t('officials.phone')}</TableColumn>
            <TableColumn>{t('officials.status')}</TableColumn>
            {/* One ⋯ button per row (N27): four text links in a row read as
                the same action. Narrow, right-aligned, and labelled for
                screen readers since the header is the only visible text. */}
            <TableColumn width={64} align="end">
              <span className="sr-only">{t('officials.actions')}</span>
            </TableColumn>
          </TableHeader>
          <TableBody>
            {visibleOfficials.flatMap((official) => {
              const isCurrentUser = official.user_id === currentUserId
              const isAdmin = official.user_id !== null && adminIds.has(official.user_id)
              const isResending = resendingId === official.id
              const isExpanded = expanded.has(official.id)

              // Two rows per official: the roster row, and the detail panel
              // beneath it when open. Returned as an array rather than a
              // fragment because HeroUI's TableBody reads its children as a
              // collection, and a fragment would hide the second row from it.
              return [
                <TableRow key={official.id}>
                  <TableCell className="text-[15px] font-medium text-ink">
                    {/* The whole name cell is the disclosure control, so the
                        target is the full-width name rather than a chevron
                        the thumb has to find. The row itself stays inert:
                        making the <tr> clickable would swallow clicks meant
                        for Remove and Re-send invite in the last column. */}
                    <button
                      type="button"
                      onClick={() => toggleExpanded(official.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`official-detail-${official.id}`}
                      className="flex w-full items-center gap-3 rounded-md text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tenant-primary"
                    >
                      <ChevronRight
                        className={`size-4 shrink-0 text-ink-faint transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      <AvatarImage
                        src={official.avatar_url}
                        initials={initialsOf(official.name)}
                        alt={official.name}
                        className="h-9 w-9 text-[13px] font-bold"
                        style={{
                          backgroundColor: (avatarColors.get(official.id) ?? WORK_AREA_COLORS[0])
                            .bg,
                          color: (avatarColors.get(official.id) ?? WORK_AREA_COLORS[0]).fg,
                        }}
                      />
                      {isCurrentUser
                        ? `${official.name} — ${t('officials.youLabel')}`
                        : official.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-[15px] text-ink-soft">
                    {formatPhoneForDisplay(official.phone)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="sm"
                      variant="flat"
                      // Exact badge colours from the design handoff, which
                      // HeroUI's `default`/`warning` palettes do not match.
                      className={
                        official.invite_status === 'confirmed'
                          ? 'bg-status-ok-bg text-status-ok-text'
                          : 'bg-status-pending-bg text-status-pending-text'
                      }
                    >
                      {official.invite_status === 'confirmed'
                        ? t('officials.confirmed')
                        : t('officials.invited')}
                    </Chip>
                    {isAdmin && (
                      <Chip
                        size="sm"
                        variant="flat"
                        // The tenant's own tint, so the badge reads as a role
                        // rather than as a third invite status.
                        className="ml-1.5 bg-tenant-primary-tint text-tenant-primary-tint-text"
                      >
                        {t('officials.adminBadge')}
                      </Chip>
                    )}
                  </TableCell>
                  <TableCell>
                    {!isCurrentUser && (
                      <OfficialActionsMenu
                        official={official}
                        isAdmin={isAdmin}
                        adminCapReached={adminCapReached}
                        busy={isResending || adminRolePendingId === official.id}
                        t={t}
                        onResend={() => setResendTarget(official)}
                        onMakeAdmin={() => setAdminRoleChange({ official, action: 'make' })}
                        onRemoveAdmin={() => setAdminRoleChange({ official, action: 'remove' })}
                        onRemove={() => setRemoveTarget(official)}
                      />
                    )}
                  </TableCell>
                </TableRow>,
                // Rendered only when open. An always-present hidden row would
                // put every official's shifts into the accessibility tree and
                // into Cmd+F, where a collapsed row implies they are not there.
                ...(isExpanded
                  ? [
                      <TableRow key={`${official.id}-detail`}>
                        {/* One cell spanning the table: the panel is about the
                            official as a whole, not about any one column.

                            colSpan is what makes this a legal row rather than
                            cosmetic. React Stately builds the collection by
                            summing `colSpan ?? 1` over a row's cells and
                            throwing unless the total equals the column count,
                            so this single cell must declare all four — and
                            must be the row's ONLY cell. Padding it out with
                            empty cells as well sums to seven and throws. */}
                        <TableCell
                          colSpan={4}
                          id={`official-detail-${official.id}`}
                          className="bg-status-neutral-bg/40 p-0"
                        >
                          <OfficialDetailPanel
                            detail={details[official.id]}
                            language={language}
                            t={t}
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

      <Modal
        isOpen={addModalOpen}
        onOpenChange={(isOpen) => !isOpen && closeAddModal()}
        classNames={{ base: 'bg-gray-50' }}
      >
        <ModalContent>
          <ModalHeader>{t('officials.addTitle')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('officials.name')}
              value={name}
              onValueChange={setName}
              placeholder={t('officials.namePlaceholder')}
              autoFocus
            />
            <div className="flex gap-2">
              <Select
                label={t('officials.phoneCountry')}
                className="w-56"
                selectedKeys={[phoneCountry]}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0] as string
                  setPhoneCountry(next as typeof phoneCountry)
                  setAddError(null)
                }}
              >
                {PHONE_COUNTRIES.map((c) => (
                  <SelectItem key={c.code} textValue={c.label}>
                    {c.label}
                  </SelectItem>
                ))}
              </Select>
              <Input
                label={t('officials.phone')}
                type="tel"
                value={phone}
                onValueChange={(value) => {
                  setPhone(value)
                  setAddError(null)
                }}
                placeholder={t('officials.phonePlaceholder')}
                description={t('officials.phoneHint')}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                onBlur={() => setPhoneTouched(true)}
                // addError is not gated on touch: it comes back from the server
                // after a submit, so the field has necessarily been used by then,
                // and hiding it would leave a rejected submit unexplained.
                isInvalid={!!addError || showPhoneError}
                errorMessage={
                  addError ?? (showPhoneError ? t('officials.invalidPhone') : undefined)
                }
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={closeAddModal}>
              {t('officials.cancel')}
            </Button>
            <Button
              color="primary"
              isDisabled={!name.trim() || !phoneIsValid}
              isLoading={pending}
              onPress={handleAdd}
            >
              {t('officials.sendInvite')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('officials.removeConfirmTitle')}
        body={t('officials.removeConfirmBody', { name: removeTarget?.name ?? '' })}
        cancelLabel={t('officials.cancel')}
        confirmLabel={t('officials.remove')}
        destructive
        onCancel={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
      />

      <ConfirmDialog
        open={adminRoleChange !== null}
        title={adminRoleDialog?.title ?? ''}
        body={adminRoleDialog?.body ?? ''}
        cancelLabel={t('officials.cancel')}
        confirmLabel={adminRoleDialog?.confirm ?? ''}
        destructive={adminRoleChange?.action === 'remove'}
        onCancel={() => setAdminRoleChange(null)}
        onConfirm={() => adminRoleChange && handleAdminRoleChange(adminRoleChange)}
      />

      <ConfirmDialog
        open={resendTarget !== null}
        title={t('officials.resendConfirmTitle')}
        body={t('officials.resendConfirmBody', { name: resendTarget?.name ?? '' })}
        cancelLabel={t('officials.cancel')}
        confirmLabel={t('officials.resendInvite')}
        onCancel={() => setResendTarget(null)}
        onConfirm={() => resendTarget && handleResend(resendTarget)}
      />
    </div>
  )
}

/**
 * N27: a row's actions behind one ⋯ button.
 *
 * Re-send, the admin role and Remove used to sit side by side as text links,
 * and four links in a row read as one kind of thing. A menu separates them
 * and keeps the destructive one last, under a divider.
 *
 * Every row shows the admin role. It is disabled, with the reason beneath
 * it, for an official who has not confirmed yet (only a confirmed official
 * can be made admin) and while the tier's cap is used up — a disabled HeroUI
 * button cannot carry a tooltip, but a menu item can carry a description.
 */
function OfficialActionsMenu({
  official,
  isAdmin,
  adminCapReached,
  busy,
  t,
  onResend,
  onMakeAdmin,
  onRemoveAdmin,
  onRemove,
}: {
  official: OfficialListItem
  isAdmin: boolean
  adminCapReached: boolean
  busy: boolean
  t: ReturnType<typeof useTranslation>['t']
  onResend: () => void
  onMakeAdmin: () => void
  onRemoveAdmin: () => void
  onRemove: () => void
}) {
  const isInvited = official.invite_status === 'invited'
  // Why "Make admin" is unavailable, if it is. Unconfirmed comes first: it
  // stays true however many places free up.
  const makeAdminBlockedBy = isInvited
    ? t('officials.makeAdminRequiresConfirmed')
    : adminCapReached
      ? t('officials.adminCapReachedShort')
      : null

  // Built as an array: HeroUI's DropdownMenu reads its children as a
  // collection, and a `false` from a conditional would not be a valid item.
  const items = [
    ...(isInvited ? [<DropdownItem key="resend">{t('officials.resendInvite')}</DropdownItem>] : []),
    isAdmin ? (
      <DropdownItem key="removeAdmin">{t('officials.removeAdminRole')}</DropdownItem>
    ) : (
      <DropdownItem key="makeAdmin" showDivider description={makeAdminBlockedBy ?? undefined}>
        {t('officials.makeAdmin')}
      </DropdownItem>
    ),
    // Not offered for an admin: remove_official revokes only the 'official'
    // role, so it would take them off the roster while leaving their admin
    // access in place. Removing the admin role comes first.
    ...(isAdmin
      ? []
      : [
          <DropdownItem key="remove" className="text-destructive" color="danger">
            {t('officials.remove')}
          </DropdownItem>,
        ]),
  ]

  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          isIconOnly
          variant="light"
          size="sm"
          isLoading={busy}
          aria-label={t('officials.actionsFor', { name: official.name })}
        >
          <MoreHorizontal className="size-5 text-ink-soft" aria-hidden="true" />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t('officials.actionsFor', { name: official.name })}
        // Shared with the Select fields so hover picks up the tenant palette
        // instead of HeroUI's grey.
        itemClasses={{ base: LISTBOX_ITEM }}
        disabledKeys={!isAdmin && makeAdminBlockedBy ? ['makeAdmin'] : []}
        onAction={(key) => {
          if (key === 'resend') onResend()
          else if (key === 'makeAdmin') onMakeAdmin()
          else if (key === 'removeAdmin') onRemoveAdmin()
          else if (key === 'remove') onRemove()
        }}
      >
        {items}
      </DropdownMenu>
    </Dropdown>
  )
}

/**
 * N17's expanded row: what this official is scheduled for, and when they said
 * they cannot work.
 *
 * Read-only by design — the card asks for a view, and every field here is
 * edited somewhere that already owns it (shifts on SCHED-01, time off on the
 * availability screen). Offering an edit affordance here would be a second
 * door onto the same data with none of those screens' conflict handling.
 *
 * Shifts come pre-folded into runs by `fetchOfficialDetail`, so one line is
 * one continuous stretch at one work area rather than one grid slot.
 */
function OfficialDetailPanel({
  detail,
  language,
  t,
}: {
  detail: OfficialDetail | undefined
  language: string
  t: ReturnType<typeof useTranslation>['t']
}) {
  const shifts = detail?.shifts ?? []
  const timeOff = detail?.timeOff ?? []

  return (
    <div className="grid gap-6 px-4 pb-5 pt-1 sm:grid-cols-2">
      <section>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
          {t('officials.detailShifts', { count: shifts.length })}
        </h3>
        {shifts.length === 0 ? (
          <p className="text-[14px] text-ink-soft">{t('officials.detailNoShifts')}</p>
        ) : (
          <ul className="space-y-1.5">
            {shifts.map((s) => (
              // Start timestamps are unique per official per work area run, so
              // they key the list without an id round trip.
              <li key={`${s.start}-${s.workAreaName ?? ''}`} className="text-[14px] text-ink">
                <span className="text-ink-soft">
                  {formatStageDate(s.start, language)}{' '}
                  <span className="tabular-nums">
                    {formatStageTime(s.start, language)}–{formatStageTime(s.end, language)}
                  </span>
                </span>{' '}
                {/* An em dash where the work area is missing: the filter in
                    fetchOfficialDetail excludes those rows, so this is a
                    belt-and-braces render rather than an expected state. */}
                <span className="font-medium">{s.workAreaName ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-ink-faint">
          {t('officials.detailTimeOff', { count: timeOff.length })}
        </h3>
        {timeOff.length === 0 ? (
          <p className="text-[14px] text-ink-soft">{t('officials.detailNoTimeOff')}</p>
        ) : (
          <ul className="space-y-1.5">
            {timeOff.map((p) => {
              // stageTimeRangeParts carries the end's own date only when the
              // period crosses midnight, which is what makes a multi-day
              // absence read correctly instead of as a zero-length one (B3).
              const parts = stageTimeRangeParts(p.startsAt, p.endsAt, language)

              return (
                <li key={p.id} className="text-[14px] text-ink">
                  <span className="text-ink-soft tabular-nums">
                    {parts ? `${parts.from}${parts.to ? ` – ${parts.to}` : ''}` : '—'}
                  </span>
                  {p.reason ? <span> · {p.reason}</span> : null}{' '}
                  {/* Who entered it matters to an admin reading the roster: an
                      official's own declaration is a statement of availability,
                      an admin's record is a scheduling decision already made. */}
                  <span className="text-ink-faint">
                    ·{' '}
                    {p.createdByRole === 'official'
                      ? t('officials.detailTimeOffSelfDeclared')
                      : t('officials.detailTimeOffByAdmin')}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
