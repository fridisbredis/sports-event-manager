/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import i18next from 'i18next'
import { I18nProvider } from './i18n-provider'
import { LanguageSwitcher } from './language-switcher'

// renderToString runs outside Next's router context, which useRouter requires.
// The switcher only reaches the router after a click, which cannot happen in a
// server render.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))

// Deliberately the node environment, with no DOM: that is what makes
// `typeof window === 'undefined'` true here, so these cases exercise the
// server path rather than the browser one. In jsdom they would all pass
// against the buggy code too.

describe('I18nProvider server rendering', () => {
  // The leak. `i18next` is one object for the whole Node process, so a render
  // that initialised it or called changeLanguage() on it changed what every
  // later request in that process rendered. In the running app that meant a
  // signed-in Swedish user's render left /login serving Swedish to everyone
  // after them — including signed-out visitors, whose client then hydrated in
  // English.
  //
  // Asserting on the singleton rather than on the output is the point: the
  // output was never the fault, the shared mutation was.
  it('leaves the shared singleton untouched when rendering in a language', () => {
    const before = i18next.language

    renderToString(
      <I18nProvider language="sv">
        <LanguageSwitcher current="sv" persist={false} />
      </I18nProvider>
    )

    expect(i18next.language).toBe(before)
    // Falsy rather than `false`: an i18next instance that has never been
    // initialised leaves the flag undefined, and "never touched" is the claim.
    expect(i18next.isInitialized).toBeFalsy()
  })

  // Two users in one process, which is every production render. Before the fix
  // the second render inherited whatever the first had set.
  it('does not let one render decide the language of the next', () => {
    const swedish = renderToString(
      <I18nProvider language="sv">
        <LanguageSwitcher current="sv" persist={false} />
      </I18nProvider>
    )
    const english = renderToString(
      <I18nProvider language="en">
        <LanguageSwitcher current="en" persist={false} />
      </I18nProvider>
    )

    expect(swedish).toContain('Språk')
    expect(english).toContain('Language')
    expect(english).not.toContain('Språk')
  })

  // Order must not matter either — the English render first, then Swedish,
  // proves the isolation is not just "the first one wins".
  it('isolates renders whichever order they arrive in', () => {
    const english = renderToString(
      <I18nProvider language="en">
        <LanguageSwitcher current="en" persist={false} />
      </I18nProvider>
    )
    const swedish = renderToString(
      <I18nProvider language="sv">
        <LanguageSwitcher current="sv" persist={false} />
      </I18nProvider>
    )

    expect(english).toContain('Language')
    expect(swedish).toContain('Språk')
  })

  // An unrecognised stored value must land on the default rather than render
  // an empty label or be published as if it were a known locale.
  it('falls back to the default locale for a language it does not know', () => {
    const html = renderToString(
      <I18nProvider language="de">
        <LanguageSwitcher current="en" persist={false} />
      </I18nProvider>
    )

    expect(html).toContain('Language')
  })
})
