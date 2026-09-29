import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Bell } from 'lucide-react'
import { EmptyState, EmptyStateCard } from './empty-state'

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(<EmptyState Icon={Bell} title="No announcements yet" description="Updates show here." />)

    expect(screen.getByText('No announcements yet')).toBeInTheDocument()
    expect(screen.getByText('Updates show here.')).toBeInTheDocument()
  })

  it('omits the description paragraph when none is given', () => {
    const { container } = render(<EmptyState Icon={Bell} title="No older announcements" />)

    expect(screen.getByText('No older announcements')).toBeInTheDocument()
    expect(container.querySelectorAll('p')).toHaveLength(1)
  })

  it('renders an action passed as children', () => {
    render(
      <EmptyState Icon={Bell} title="No older announcements">
        <a href="?page=1">Back to newest</a>
      </EmptyState>
    )

    expect(screen.getByRole('link', { name: 'Back to newest' })).toBeInTheDocument()
  })

  it('hides the icon from assistive tech — the title already carries the meaning', () => {
    const { container } = render(<EmptyState Icon={Bell} title="No assignments yet" />)

    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('boxes the card variant on the shared card surface', () => {
    const { container } = render(<EmptyStateCard Icon={Bell} title="No programme yet" />)

    expect(container.firstChild).toHaveClass('bg-white', 'border', 'rounded-card')
  })
})
