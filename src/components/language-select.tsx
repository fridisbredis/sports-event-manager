'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
// SelectItem comes straight from HeroUI, as it does everywhere else: the
// wrapper styles the items through the Select's listboxProps, so there is no
// wrapped item component to import.
import { SelectItem } from '@heroui/react'
import { Select } from '@/components/ui/form-fields'
import { useTranslation } from '@/lib/i18n/client'
import { locales, type Locale } from '@/lib/i18n/config'
import { toastError } from '@/lib/toast'

// Written in its own language rather than translated: a user who has landed in
// a language they cannot read must still be able to find their own. This is
// why it is a literal map and not t('language.swedish') — "Svenska" has to read
// as Svenska even while the surrounding UI is English.
//
// The flag is a regional-indicator pair, so it needs no asset and no icon
// dependency: lucide-react ships only a generic Flag glyph. It is decoration,
// not the label — a flag names a country, not a language, so the language name
// beside it is what actually identifies the option, and the flag is hidden from
// screen readers.
const LANGUAGES: Record<Locale, { name: string; flag: string }> = {
  en: { name: 'English', flag: '🇬🇧' },
  sv: { name: 'Svenska', flag: '🇸🇪' },
}

interface Props {
  current: Locale
  className?: string
}

/**
 * The system-admin language control: a select rather than the two-option
 * button group in LanguageSwitcher.
 *
 * Kept separate from LanguageSwitcher instead of added there as a fourth
 * variant. That component is shared by the account screen, the invite page and
 * the sign-in surfaces, where the switch is a pair of visible options; folding
 * a select into it would have meant a variant that shares none of its markup.
 * The persistence below is the part worth matching, and it is matched exactly.
 */
export function LanguageSelect({ current, className = '' }: Props) {
  // The instance from the surrounding I18nextProvider, not the imported
  // singleton: on the server that singleton is shared across every request in
  // the process, and this must never be what mutates it.
  const { t, i18n } = useTranslation('common')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [language, setLanguage] = useState<Locale>(current)
  const [saving, setSaving] = useState(false)

  async function handleSelect(next: Locale) {
    if (next === language || saving) return

    const previous = language

    // Switch the client-side language first so strings rendered in the browser
    // update immediately instead of waiting for the round trip. Server-rendered
    // text still needs the refresh below, which is why the control stays
    // disabled until both halves have landed.
    setLanguage(next)
    i18n.changeLanguage(next)

    setSaving(true)
    try {
      const res = await fetch('/api/account/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      })

      if (!res.ok) throw new Error('save failed')

      // Server components resolve their language with getUserLanguage() at
      // render time, so their text is still in the old language until the
      // route re-renders.
      startTransition(() => router.refresh())
    } catch {
      // Put the control and the client-side language back, so what is shown
      // matches what is actually stored.
      setLanguage(previous)
      i18n.changeLanguage(previous)
      toastError(t('language.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Select
      // No visible label: the control sits alone in the top bar, and the
      // selected value already names the language. aria-label carries what the
      // removed heading used to say.
      aria-label={t('language.label')}
      selectedKeys={[language]}
      onSelectionChange={(keys) => {
        const next = Array.from(keys)[0] as Locale | undefined
        // HeroUI emits an empty set when the open menu is dismissed without a
        // pick. Treating that as a value would try to switch to undefined.
        if (next) handleSelect(next)
      }}
      isDisabled={saving}
      size="sm"
      className={`w-44 ${className}`}
      // The trigger shows flag + name, matching each option rather than
      // falling back to the raw locale code.
      renderValue={(items) =>
        items.map((item) => {
          const locale = item.key as Locale
          return (
            <span key={locale} className="flex items-center gap-2">
              <span aria-hidden="true">{LANGUAGES[locale].flag}</span>
              <span>{LANGUAGES[locale].name}</span>
            </span>
          )
        })
      }
    >
      {locales.map((locale) => (
        <SelectItem key={locale} textValue={LANGUAGES[locale].name}>
          <span lang={locale} className="flex items-center gap-2">
            <span aria-hidden="true">{LANGUAGES[locale].flag}</span>
            <span>{LANGUAGES[locale].name}</span>
          </span>
        </SelectItem>
      ))}
    </Select>
  )
}
