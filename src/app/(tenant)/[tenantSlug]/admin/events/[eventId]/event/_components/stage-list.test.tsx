import { fireEvent, render, screen } from '@testing-library/react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from 'react'
import { describe, expect, it, vi } from 'vitest'
import StageList from './stage-list'

vi.mock('./stage-modal', () => ({ default: () => null }))
vi.mock('@/components/confirm-dialog', () => ({ default: () => null }))
vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onPress,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & { onPress?: () => void }) => (
    <button onClick={onPress} {...props}>
      {children}
    </button>
  ),
}))
vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/components/i18n-provider', () => ({
  useLanguage: () => 'sv',
}))
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

describe('StageList', () => {
  it('shows the stage explanation and links to the glossary', () => {
    render(
      <StageList stages={[]} onChange={vi.fn()} guideHref="/viadal/admin/events/1/dashboard" />
    )

    fireEvent.click(screen.getByRole('button', { name: 'eventConfig.stageHelpToggle' }))

    expect(screen.getByText('eventConfig.stageHelpTitle')).toBeInTheDocument()
    expect(screen.getByText('eventConfig.stageHelpBody')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'eventConfig.stageHelpMore' })).toHaveAttribute(
      'href',
      '/viadal/admin/events/1/dashboard'
    )
  })
})
