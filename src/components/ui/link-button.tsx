'use client'

import { Button as HeroButton, type ButtonProps } from '@heroui/react'

// A button that reads as a text link: no background, no padding box, and a
// hover that deepens the colour rather than painting a plate behind the words.
//
// HeroUI's `light` variant is the closest built-in, but it fills a rounded grey
// background on hover that sits tight against short labels ("Re-send invite"),
// so the whole hit area lights up as a chip. Here the label itself is the
// affordance — underlined on hover, darker on press — which is what a text
// action should do.
//
// `tone` picks the colour: the tenant's theme for ordinary actions, the
// destructive red for removals.
export function LinkButton({
  tone = 'primary',
  className,
  ...props
}: Omit<ButtonProps, 'variant' | 'color'> & { tone?: 'primary' | 'danger' }) {
  const toneClasses =
    tone === 'danger'
      ? 'text-danger-text hover:text-danger-hover'
      : 'text-tenant-primary hover:text-tenant-primary-hover'

  return (
    <HeroButton
      {...props}
      variant="light"
      disableRipple
      // `h-auto min-w-0 p-0` strips the button box so the text sits on the
      // baseline like a link; `bg-transparent` on every state removes the
      // plate HeroUI's light variant paints on hover and press.
      className={`h-auto min-w-0 justify-start gap-1 bg-transparent p-0 font-semibold underline-offset-4 transition-colors hover:underline data-[hover=true]:bg-transparent data-[pressed=true]:bg-transparent data-[hover=true]:opacity-100 ${toneClasses} ${className ?? ''}`}
    />
  )
}
