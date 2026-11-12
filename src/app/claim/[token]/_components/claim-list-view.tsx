'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { CircleAlert, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/form-fields'
import { CARD_SURFACE } from '@/components/ui/card-styles'
import { useTranslation } from '@/lib/i18n/client'
import { matchesClaimSearch, type ClaimListRow } from '@/lib/participants/claim-search'

interface Props {
  token: string
  event: { name: string; logoUrl: string | null }
  /** null = claiming is not open (draft, unpublished or below Premium). */
  participants: ClaimListRow[] | null
}

// CLAIM-01, mobile first. Wireframes: Participant_view CLAIM-01 list,
// search-no-match, not-available.
export default function ClaimListView({ token, event, participants }: Props) {
  const { t } = useTranslation('auth')
  const [query, setQuery] = useState('')

  const visible = useMemo(
    () => (participants ?? []).filter((row) => matchesClaimSearch(row, query)),
    [participants, query]
  )

  // Where both buttons lead: CLAIM-02. For a claimed row ("This is me") the
  // page itself sees the claim and ends the form as a conflict (N42), so the
  // URL is the same. The participant id is safe to put in the URL — CLAIM-02
  // re-checks it belongs to this token's event, exactly as this list does.
  const claimHref = (row: ClaimListRow) =>
    `/claim/${encodeURIComponent(token)}/${encodeURIComponent(row.id)}`

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col px-4 pb-12 pt-10">
      <header className="flex flex-col items-center text-center">
        {event.logoUrl ? (
          <Image
            src={event.logoUrl}
            alt=""
            width={72}
            height={72}
            className="size-[72px] rounded-2xl object-cover"
          />
        ) : null}
        <h1 className="mt-4 text-[22px] font-bold leading-snug text-ink">{event.name}</h1>
        {participants ? (
          <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">{t('claimList.intro')}</p>
        ) : null}
      </header>

      {participants === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
          <CircleAlert className="size-12 text-ink-label" strokeWidth={1.5} aria-hidden="true" />
          <p className="text-[15px] text-ink-soft">{t('claimList.notAvailable')}</p>
        </div>
      ) : (
        <>
          <div className="mt-6">
            <Input
              aria-label={t('claimList.searchLabel')}
              placeholder={t('claimList.searchPlaceholder')}
              value={query}
              onValueChange={setQuery}
              startContent={<Search className="size-4 text-ink-label" aria-hidden="true" />}
              isClearable
              onClear={() => setQuery('')}
              // Bibs are mostly digits, but names are not; a numeric keyboard
              // would lock half the runners out of their own search.
              type="search"
              autoComplete="off"
            />
          </div>

          {visible.length === 0 ? (
            <p className="py-16 text-center text-[15px] font-semibold text-ink" role="status">
              {participants.length === 0 ? t('claimList.empty') : t('claimList.noMatch')}
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3" aria-label={t('claimList.listLabel')}>
              {visible.map((row) => (
                <li
                  key={row.id}
                  className={`${CARD_SURFACE} flex min-h-[64px] items-center gap-4 px-4 py-3`}
                >
                  <span className="w-12 shrink-0 text-[15px] font-semibold tabular-nums text-ink">
                    {row.bib ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
                    {row.name ?? '–'}
                  </span>
                  {row.claimed ? (
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="rounded-full bg-status-neutral-bg px-2.5 py-0.5 text-xs font-medium text-ink-muted">
                        {t('claimList.claimed')}
                      </span>
                      <Link
                        href={claimHref(row)}
                        className="text-[13px] text-ink-soft underline underline-offset-2"
                      >
                        {t('claimList.thisIsMe')}
                      </Link>
                    </div>
                  ) : (
                    <Button
                      as={Link}
                      href={claimHref(row)}
                      color="primary"
                      size="sm"
                      className="shrink-0"
                      aria-label={t('claimList.claimFor', { name: row.name ?? row.bib ?? '' })}
                    >
                      {t('claimList.claim')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  )
}
