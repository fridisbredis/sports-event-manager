import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ColorThemeForm } from './color-theme-form'
import { updateTenantColorPalette } from '../actions'
import { TENANT_PALETTES } from '@/lib/theme/tenant-colors'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../actions', () => ({ updateTenantColorPalette: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toastError: vi.fn() }))
vi.mock('@/lib/hooks/use-unsaved-changes', () => ({
  useUnsavedChanges: () => ({
    markDirty: vi.fn(),
    markClean: vi.fn(),
    dialogProps: { open: false, onLeave: vi.fn(), onStay: vi.fn() },
  }),
}))
vi.mock('@/components/unsaved-changes-dialog', () => ({ default: () => null }))

const TENANT_ID = '11111111-1111-1111-1111-111111111111'

function renderForm(canChooseColorTheme = true) {
  return render(
    <ColorThemeForm
      tenantSlug="viadal"
      tenantId={TENANT_ID}
      initialColorPalette="blue"
      canChooseColorTheme={canChooseColorTheme}
    />
  )
}

const swatch = (name: string) => screen.getByRole('button', { name: `settings.colorTheme${name}` })
const saveButton = () => screen.getByRole('button', { name: 'settings.save' })
const primaryVar = () => document.documentElement.style.getPropertyValue('--tenant-primary')

beforeEach(() => {
  vi.clearAllMocks()
  document.documentElement.removeAttribute('style')
})

describe('ColorThemeForm', () => {
  it('previews a picked palette without writing it until Save', async () => {
    vi.mocked(updateTenantColorPalette).mockResolvedValue({})
    renderForm()
    expect(saveButton()).toBeDisabled()

    fireEvent.click(swatch('Purple'))

    expect(swatch('Purple')).toHaveAttribute('aria-pressed', 'true')
    expect(primaryVar()).toBe(TENANT_PALETTES.purple.primary)
    expect(updateTenantColorPalette).not.toHaveBeenCalled()

    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(updateTenantColorPalette).toHaveBeenCalledWith('viadal', TENANT_ID, 'purple')
    )
    expect(await screen.findByRole('button', { name: 'settings.saved' })).toBeInTheDocument()
  })

  it('puts the stored palette back when the write fails', async () => {
    vi.mocked(updateTenantColorPalette).mockResolvedValue({ error: 'nope' })
    renderForm()

    fireEvent.click(swatch('Purple'))
    fireEvent.click(saveButton())

    await waitFor(() => expect(swatch('Blue')).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByText('settings.colorThemeError')).toBeInTheDocument()
    expect(primaryVar()).toBe(TENANT_PALETTES.blue.primary)
  })

  // Below the unlocking tier the swatches still show what the feature offers,
  // but there is nothing to save.
  it('shows no Save button when the tier does not include the theme', () => {
    renderForm(false)
    expect(screen.queryByRole('button', { name: 'settings.save' })).toBeNull()
    expect(swatch('Purple')).toBeDisabled()
  })
})
