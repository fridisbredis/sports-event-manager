'use client'

import { useState, useTransition } from 'react'
import { AppCard } from '@/components/ui/app-card'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/i18n/client'
import { toastError } from '@/lib/toast'
import { useUnsavedChanges } from '@/lib/hooks/use-unsaved-changes'
import UnsavedChangesDialog from '@/components/unsaved-changes-dialog'
import type { TenantPaletteKey } from '@/lib/theme/tenant-colors'
import { tenantThemeVars } from '@/lib/theme/tenant-theme-style'
import { updateTenantColorPalette } from '../actions'
import { ColorPalettePicker } from './color-palette-picker'

interface Props {
  tenantSlug: string
  tenantId: string
  initialColorPalette: string
  canChooseColorTheme: boolean
}

// Repaint the theme straight onto :root. TenantThemeStyle is a server
// component — it emits its <style> when the layout renders, so on its own the
// colour could not change until the server re-rendered. Setting the variables
// here makes the preview immediate; the server's own <style> takes over
// unchanged on the next render, because it resolves to exactly these values.
function paintTheme(key: string) {
  const root = document.documentElement
  for (const [name, value] of tenantThemeVars(key)) {
    root.style.setProperty(name, value)
  }
}

export function ColorThemeForm({
  tenantSlug,
  tenantId,
  initialColorPalette,
  canChooseColorTheme,
}: Props) {
  const { t } = useTranslation('admin')
  // Leaving with an unsaved palette has to put the theme back: the preview is
  // written onto :root, which survives the navigation, so the abandoned colour
  // would otherwise follow the admin to the next page and read as saved.
  const { markDirty, markClean, dialogProps } = useUnsavedChanges({
    onDiscard: () => paintTheme(savedPalette),
  })

  // What is being previewed, and what the database holds. Save compares the
  // two, and a failed write rolls the preview back to the saved one.
  const [colorPalette, setColorPalette] = useState(initialColorPalette)
  const [savedPalette, setSavedPalette] = useState(initialColorPalette)

  // A fresh server payload (after a save, or any revalidate of this route)
  // re-seeds both: useState alone keeps its mount-time value forever, which
  // would leave the picker showing a palette the database no longer holds.
  const [renderedPalette, setRenderedPalette] = useState(initialColorPalette)
  if (renderedPalette !== initialColorPalette) {
    setRenderedPalette(initialColorPalette)
    setSavedPalette(initialColorPalette)
    setColorPalette(initialColorPalette)
  }

  const [paletteError, setPaletteError] = useState<string | undefined>()
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [isSaving, startSave] = useTransition()
  const isDirty = colorPalette !== savedPalette

  // Picking a palette only previews it; Save writes it. A palette tried on and
  // abandoned leaves nothing behind, and the leave-guard can warn about it.
  function handleSelect(key: TenantPaletteKey) {
    if (key === colorPalette) return
    setColorPalette(key)
    paintTheme(key)
    setPaletteError(undefined)
    setSaveSuccess(false)
    if (key === savedPalette) markClean()
    else markDirty()
  }

  function handleSave() {
    startSave(async () => {
      const result = await updateTenantColorPalette(
        tenantSlug,
        tenantId,
        colorPalette as TenantPaletteKey
      )
      if (result.error) {
        // Put the preview back to what is actually stored so the page does
        // not claim a colour the database never took.
        setColorPalette(savedPalette)
        paintTheme(savedPalette)
        setPaletteError(t('settings.colorThemeError'))
        toastError(t('settings.colorThemeError'))
        markClean()
        return
      }
      setSavedPalette(colorPalette)
      setSaveSuccess(true)
      markClean()
    })
  }

  return (
    <section>
      <UnsavedChangesDialog {...dialogProps} />
      <h2 className="section-label mb-5">{t('settings.appearance')}</h2>
      <AppCard className="card-accent-primary" bodyClassName="space-y-5 p-6">
        <ColorPalettePicker
          colorPalette={colorPalette}
          isSavingPalette={isSaving}
          paletteError={paletteError}
          onSelect={handleSelect}
          isLocked={!canChooseColorTheme}
        />
        {canChooseColorTheme && (
          <div className="flex justify-end">
            <Button
              onPress={handleSave}
              isDisabled={(!isDirty && !saveSuccess) || isSaving}
              isLoading={isSaving}
              color={saveSuccess && !isSaving ? 'success' : 'primary'}
            >
              {isSaving
                ? t('settings.saving')
                : saveSuccess
                  ? t('settings.saved')
                  : t('settings.save')}
            </Button>
          </div>
        )}
      </AppCard>
    </section>
  )
}
