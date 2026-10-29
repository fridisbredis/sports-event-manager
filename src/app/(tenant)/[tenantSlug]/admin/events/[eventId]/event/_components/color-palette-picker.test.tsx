import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import { ColorPalettePicker } from './color-palette-picker'
import { TENANT_PALETTES } from '@/lib/theme/tenant-colors'

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('ColorPalettePicker', () => {
  it('offers exactly the palettes the theme defines', () => {
    render(
      <ColorPalettePicker
        colorPalette="blue"
        isSavingPalette={false}
        paletteError={undefined}
        onSelect={vi.fn()}
      />
    )

    // The picker builds its i18n key from the palette name, so a palette with
    // no matching key renders the raw key string. Asserting on the key catches
    // a palette added to the theme but not to the locale file.
    for (const key of Object.keys(TENANT_PALETTES)) {
      const label = `eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
  })

  it('marks the stored palette as pressed, whichever one it is', () => {
    for (const key of Object.keys(TENANT_PALETTES)) {
      const { unmount } = render(
        <ColorPalettePicker
          colorPalette={key}
          isSavingPalette={false}
          paletteError={undefined}
          onSelect={vi.fn()}
        />
      )
      const label = `eventConfig.colorTheme${key.charAt(0).toUpperCase()}${key.slice(1)}`
      const pressed = screen
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
      expect(pressed).toHaveLength(1)
      expect(pressed[0].textContent).toContain(label)
      unmount()
    }
  })
})

// Mirrors the re-seeding EventConfigForm does: the palette is saved on click
// and the route revalidates, so a fresh prop must win over the mounted state.
// Without that, the picker keeps its mount-time value and appears to snap back
// to the previously stored colour.
function Harness({ initial }: { initial: string }) {
  const [selected, setSelected] = useState(initial)
  const [rendered, setRendered] = useState(initial)
  if (rendered !== initial) {
    setRendered(initial)
    setSelected(initial)
  }
  return (
    <ColorPalettePicker
      colorPalette={selected}
      isSavingPalette={false}
      paletteError={undefined}
      onSelect={(k) => setSelected(k)}
    />
  )
}

describe('palette selection after a revalidate', () => {
  it('follows a changed prop instead of keeping the mount-time value', () => {
    const { rerender } = render(<Harness initial="blue" />)

    const pressedLabel = () =>
      screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')
        ?.textContent

    expect(pressedLabel()).toContain('Blue')

    // A new server payload arrives naming a different palette.
    rerender(<Harness initial="purple" />)
    expect(pressedLabel()).toContain('Purple')

    // And back again — the direction that was broken.
    rerender(<Harness initial="blue" />)
    expect(pressedLabel()).toContain('Blue')
  })
})
