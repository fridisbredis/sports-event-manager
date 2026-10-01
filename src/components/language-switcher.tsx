'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/lib/i18n/client'
import { locales, type Locale } from '@/lib/i18n/config'
import { toastError } from '@/lib/toast'

// Language names are deliberately not translated: each one is written in its
// own language, so a user who has landed in a language they cannot read can
// still find their own. This is why they are a literal map rather than
// t('language.swedish') — "Svenska" must read as Svenska even to someone
// currently seeing English.
const LANGUAGE_NAMES: Record<Locale, string> = {
  en: 'English',
  sv: 'Svenska',
}

interface Props {
  current: Locale
  /**
   * Signed-out surfaces (the invite page) have no user row to write to, so the
   * switch only changes the language in the browser. The invite flow stores
   * the choice itself when the invite is confirmed.
   */
  persist?: boolean
  /**
   * Notified on every successful switch. Needed by surfaces that carry the
   * choice themselves rather than letting this component store it — the
   * invite page sends it along with the confirm call.
   */
  onChange?: (language: Locale) => void
  /**
   * Stretch the options to fill the container. For the sidebars, where the
   * control spans the rail like the nav rows above it. Left off where the
   * switcher shares a row with other content — the account form puts it
   * opposite a label, and there it should stay at its own width.
   */
  fill?: boolean
  /**
   * 'outlined' (default) is the quiet admin-sidebar form: two bordered options
   * on white, distinguished by weight rather than colour, so it also renders
   * correctly where no TenantThemeStyle is mounted.
   *
   * 'solid' is the official-facing form: one capsule, the selected option
   * filled in the tenant's primary colour. Only for surfaces that mount
   * TenantThemeStyle — on the system-admin surface and /login,
   * --tenant-primary is undefined and the fill would come out unpainted. The
   * invite page does mount it, from the tenant its token belongs to.
   *
   * 'stacked' is 'outlined' turned vertical, for the collapsed admin rail:
   * two options side by side do not fit 4rem, but stacked they do, so the
   * control stays reachable instead of disappearing until the rail is reopened.
   */
  variant?: 'outlined' | 'solid' | 'stacked'
  className?: string
}

export function LanguageSwitcher({
  current,
  persist = true,
  onChange,
  fill = false,
  variant = 'outlined',
  className = '',
}: Props) {
  // The instance behind the surrounding I18nextProvider, not the imported
  // i18next singleton: on the server that singleton is shared by every request
  // in the process, and this component must never be the thing that mutates it.
  // useTranslation() hands back the instance its own provider supplied, which
  // is the client one wherever this component can actually be clicked.
  const { t, i18n } = useTranslation('common')
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [language, setLanguage] = useState<Locale>(current)
  const [saving, setSaving] = useState(false)

  async function handleSelect(next: Locale) {
    if (next === language || saving) return

    const previous = language

    // Switch the client-side language first so every string rendered in the
    // browser updates immediately, rather than waiting for the round trip.
    // Server-rendered text still needs the refresh below — the two halves land
    // a moment apart, which is why the control stays disabled until both are
    // done.
    setLanguage(next)
    i18n.changeLanguage(next)
    onChange?.(next)

    if (!persist) return

    setSaving(true)
    try {
      const res = await fetch('/api/account/language', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: next }),
      })

      if (!res.ok) throw new Error('save failed')

      // Server components resolve their language with getUserLanguage() at
      // render time, so the text they produced is still in the old language
      // until the route re-renders.
      startTransition(() => router.refresh())
    } catch {
      // Put the control and the client-side language back where they were, so
      // what the user sees matches what is actually stored.
      setLanguage(previous)
      i18n.changeLanguage(previous)
      onChange?.(previous)
      toastError(t('language.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const solid = variant === 'solid'
  const stacked = variant === 'stacked'

  return (
    // Two shapes for two audiences.
    //
    // 'outlined' — the admin sidebars and the sign-in page. Separate bordered
    // options on white, telling the selected one apart by weight and ground
    // rather than by an accent colour. A filled accent chip in a sidebar
    // outweighed the active nav row beside it, and both surfaces also have to
    // render where no TenantThemeStyle is mounted and --tenant-primary
    // resolves to nothing.
    //
    // 'solid' — the official-facing account screen and the invite page. One
    // capsule with the selected option filled in the tenant's primary colour: a
    // standalone control with no nav beside it to compete with. The colour is
    // the tenant token, not a fixed blue, so it follows each tenant's theme.
    //
    // 'stacked' — the collapsed admin rail. Same outlined options, laid out
    // vertically because two of them do not fit 4rem side by side.
    <div
      role="group"
      aria-label={t('language.label')}
      className={`flex ${stacked ? 'flex-col gap-1.5' : ''} ${
        solid ? 'gap-0 rounded-full bg-status-neutral-bg p-1' : stacked ? '' : 'gap-2'
      } ${fill ? 'w-full' : ''} ${className}`}
    >
      {locales.map((locale) => {
        const active = locale === language
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            onClick={() => handleSelect(locale)}
            disabled={saving}
            aria-pressed={active}
            className={`text-xs font-semibold uppercase transition-colors disabled:opacity-60 ${
              // Stacked options span the rail rather than sitting at a fixed
              // width; the horizontal forms either divide the row (fill) or
              // keep both options the same width whatever the code is.
              stacked ? 'w-full px-2' : `px-4 ${fill ? 'flex-1' : 'min-w-14'}`
            } ${
              solid
                ? `rounded-full py-1.5 ${
                    active ? 'bg-tenant-primary text-white' : 'text-ink-soft hover:text-ink'
                  }`
                : `rounded-control border py-1.5 ${
                    active
                      ? 'border-edge bg-status-neutral-bg text-ink'
                      : 'border-edge bg-white text-ink-soft hover:bg-surface hover:text-ink'
                  }`
            }`}
          >
            {/* The code is what shows; the full name is for screen readers, and
                each is written in its own language so a user who has landed in
                one they cannot read still recognises their own. */}
            <span className="sr-only">{LANGUAGE_NAMES[locale]}</span>
            <span aria-hidden="true">{locale}</span>
          </button>
        )
      })}
    </div>
  )
}
