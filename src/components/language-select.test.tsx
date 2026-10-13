import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LanguageSelect } from './language-select'

const changeLanguage = vi.fn()
const refresh = vi.fn()
const toastError = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage },
  }),
}))

vi.mock('@/lib/toast', () => ({
  toastError: (message: string) => toastError(message),
}))

// HeroUI's Select renders a button-plus-portal listbox that needs real pointer
// sequencing to open. Swapped for a native <select> so the test drives the
// component's own selection logic — the part worth covering — rather than
// HeroUI's menu internals. The onSelectionChange shape is preserved, including
// the Set it hands back, so the component is exercised exactly as it is
// written.
vi.mock('@/components/ui/form-fields', () => ({
  Select: ({
    children,
    selectedKeys,
    onSelectionChange,
    isDisabled,
    renderValue,
    ...props
  }: {
    children?: ReactNode
    selectedKeys?: string[]
    onSelectionChange?: (keys: Set<string>) => void
    isDisabled?: boolean
    renderValue?: (items: { key: string }[]) => ReactNode
    [key: string]: unknown
  }) => (
    <div>
      {/* What the trigger would show, so flag-and-name rendering is covered. */}
      <div data-testid="trigger">{renderValue?.([{ key: selectedKeys?.[0] as string }])}</div>
      <select
        aria-label={props['aria-label'] as string}
        value={selectedKeys?.[0] ?? ''}
        disabled={isDisabled}
        onChange={(e) => onSelectionChange?.(new Set([e.target.value]))}
      >
        {children}
      </select>
    </div>
  ),
}))

// A native <option> needs a value to be selectable, and `key` is consumed by
// React rather than passed down, so the locale is recovered from textValue —
// the one prop the component does hand each item.
vi.mock('@heroui/react', () => ({
  SelectItem: ({ textValue }: { children?: ReactNode; textValue?: string }) => {
    const locale = textValue === 'Svenska' ? 'sv' : 'en'
    return (
      <option value={locale} label={textValue}>
        {textValue}
      </option>
    )
  },
}))

function mockFetch(impl: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(impl))
}

const trigger = () => screen.getByTestId('trigger')
const select = () => screen.getByLabelText('language.label')

describe('LanguageSelect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch(async () => new Response(null, { status: 200 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows the current language with its flag', () => {
    render(<LanguageSelect current="sv" />)
    expect(trigger()).toHaveTextContent('Svenska')
    expect(trigger()).toHaveTextContent('🇸🇪')
  })

  it('names itself for assistive tech, since the visible heading is gone', () => {
    render(<LanguageSelect current="sv" />)
    expect(select()).toBeInTheDocument()
  })

  it('offers each language written in its own language', () => {
    render(<LanguageSelect current="sv" />)
    const labels = Array.from(select().querySelectorAll('option')).map((o) => o.textContent)
    expect(labels).toEqual(expect.arrayContaining(['English', 'Svenska']))
  })

  it('persists the pick and refreshes the server-rendered text', async () => {
    render(<LanguageSelect current="sv" />)
    fireEvent.change(select(), { target: { value: 'en' } })

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/account/language',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ language: 'en' }),
        })
      )
    })

    // Both halves: the browser switches at once, the server re-renders after.
    expect(changeLanguage).toHaveBeenCalledWith('en')
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('reverts the control and the client language when the save fails', async () => {
    mockFetch(async () => new Response(null, { status: 500 }))
    render(<LanguageSelect current="sv" />)
    fireEvent.change(select(), { target: { value: 'en' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('language.saveFailed'))

    // What is shown has to match what is stored, so both the trigger and the
    // client-side language go back.
    expect(changeLanguage).toHaveBeenLastCalledWith('sv')
    await waitFor(() => expect(trigger()).toHaveTextContent('Svenska'))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not write when the language picked is the current one', () => {
    render(<LanguageSelect current="sv" />)
    fireEvent.change(select(), { target: { value: 'sv' } })

    expect(fetch).not.toHaveBeenCalled()
    expect(changeLanguage).not.toHaveBeenCalled()
  })

  it('ignores an empty selection, as dismissing the menu produces', () => {
    render(<LanguageSelect current="sv" />)
    fireEvent.change(select(), { target: { value: '' } })

    expect(fetch).not.toHaveBeenCalled()
    expect(changeLanguage).not.toHaveBeenCalled()
  })
})
