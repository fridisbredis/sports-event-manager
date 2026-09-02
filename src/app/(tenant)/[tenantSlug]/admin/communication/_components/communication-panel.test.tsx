import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { CommunicationPanel } from './communication-panel'
import type { Announcement } from '@/types/app'

// Shared translate stub: returns the i18n key so assertions check which key was
// used rather than depending on real translation strings. Declared via
// vi.hoisted so the hoisted vi.mock factory and the tests can both see it.
const { fakeT } = vi.hoisted(() => ({
  fakeT: (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

const { push } = vi.hoisted(() => ({ push: vi.fn() }))

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: fakeT }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

vi.mock('@/lib/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/toast')>()
  return { ...actual, toastError: vi.fn() }
})

vi.mock('@/components/ui/app-card', () => ({
  AppCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/form-fields', () => ({
  Textarea: ({
    value,
    onValueChange,
    placeholder,
  }: {
    value?: string
    onValueChange?: (v: string) => void
    placeholder?: string
  }) => (
    <textarea
      value={value}
      placeholder={placeholder}
      onChange={(e) => onValueChange?.(e.target.value)}
    />
  ),
}))

// HeroUI's real components need react-aria portals and framer-motion, neither of
// which is set up in jsdom and neither of which is the point here. Same
// stand-in approach the officials-list test uses.
vi.mock('@heroui/react', () => {
  const Button = ({
    children,
    onPress,
    isDisabled,
  }: {
    children?: ReactNode
    onPress?: () => void
    isDisabled?: boolean
  }) => (
    <button type="button" disabled={isDisabled} onClick={() => onPress?.()}>
      {children}
    </button>
  )

  // The real Modal routes its content's `onClose` back through
  // onOpenChange(false), which is how the Cancel button reaches onCancel.
  // The stub has to preserve that wiring or Cancel would be a no-op here.
  let closeCurrentModal: () => void = () => {}

  const Modal = ({
    isOpen,
    onOpenChange,
    children,
  }: {
    isOpen?: boolean
    onOpenChange?: (open: boolean) => void
    children?: ReactNode
  }) => {
    closeCurrentModal = () => onOpenChange?.(false)
    return isOpen ? <div role="dialog">{children}</div> : null
  }

  const ModalContent = ({
    children,
  }: {
    children?: ReactNode | ((close: () => void) => ReactNode)
  }) => (typeof children === 'function' ? children(closeCurrentModal) : children)

  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>

  return {
    Button,
    Modal,
    ModalContent,
    ModalHeader: passthrough,
    ModalBody: passthrough,
    ModalFooter: passthrough,
  }
})

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const BASE_TIME = Date.parse('2026-08-01T10:00:00.000Z')

function announcement(channel: 'participants' | 'officials', i: number): Announcement {
  return {
    id: `${channel}-${i}`,
    tenant_id: TENANT_ID,
    channel,
    body: `${channel} body ${i}`,
    sms_sent: false,
    published_at: new Date(BASE_TIME - i * 60_000).toISOString(),
    created_at: new Date(BASE_TIME - i * 60_000).toISOString(),
  } as Announcement
}

function renderPanel(overrides: Partial<Parameters<typeof CommunicationPanel>[0]> = {}) {
  const props = {
    tenantId: TENANT_ID,
    page: 1,
    announcements: {
      participants: [announcement('participants', 0)],
      officials: [announcement('officials', 0)],
    },
    hasMore: { participants: false, officials: false },
    ...overrides,
  }
  return render(<CommunicationPanel {...props} />)
}

function typeDraft(text: string) {
  fireEvent.change(screen.getByPlaceholderText('communication.announcementPlaceholder'), {
    target: { value: text },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) } as never))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('CommunicationPanel', () => {
  it('shows the selected channel its own list', () => {
    renderPanel()

    expect(screen.getByText('participants body 0')).toBeDefined()
    expect(screen.queryByText('officials body 0')).toBeNull()

    fireEvent.click(screen.getByText('communication.officials'))

    expect(screen.getByText('officials body 0')).toBeDefined()
    expect(screen.queryByText('participants body 0')).toBeNull()
  })

  // The whole point of keeping channel in local state (PERF-06 card 1): the
  // toggle must not cost a navigation, and so must not cost an SSR render.
  it('switches channel without navigating', () => {
    renderPanel()

    fireEvent.click(screen.getByText('communication.officials'))

    expect(push).not.toHaveBeenCalled()
  })

  it('offers the older page only for a channel that has one', () => {
    renderPanel({ hasMore: { participants: true, officials: false } })

    expect(screen.getByText('communication.older')).toBeDefined()

    fireEvent.click(screen.getByText('communication.officials'))

    expect(screen.queryByText('communication.older')).toBeNull()
  })

  it('navigates to the older page with a clean draft', () => {
    renderPanel({ hasMore: { participants: true, officials: false } })

    fireEvent.click(screen.getByText('communication.older'))

    expect(push).toHaveBeenCalledWith('?page=2')
  })

  it('offers the newer page past page 1', () => {
    renderPanel({ page: 2 })

    fireEvent.click(screen.getByText('communication.newer'))

    expect(push).toHaveBeenCalledWith('?page=1')
  })

  // Paging is a navigation, so it can lose typed text the same way switching
  // channel can lose the draft's intended audience. Both go through the guard.
  it('guards a page change when the draft is dirty', () => {
    renderPanel({ hasMore: { participants: true, officials: false } })
    typeDraft('halv skriven')

    fireEvent.click(screen.getByText('communication.older'))

    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeDefined()

    fireEvent.click(screen.getByText('communication.discardAndContinue'))

    expect(push).toHaveBeenCalledWith('?page=2')
  })

  it('keeps the page when the guard is cancelled', () => {
    renderPanel({ hasMore: { participants: true, officials: false } })
    typeDraft('halv skriven')

    fireEvent.click(screen.getByText('communication.older'))
    fireEvent.click(screen.getByText('communication.cancel'))

    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('publishes then performs the navigation the guard held back', async () => {
    renderPanel({ hasMore: { participants: true, officials: false } })
    typeDraft('viktig info')

    fireEvent.click(screen.getByText('communication.older'))
    // Both the composer and the dialog carry the publish label while the
    // dialog is open; the dialog's is the last one rendered.
    const publishButtons = screen.getAllByText('communication.publish')
    fireEvent.click(publishButtons[publishButtons.length - 1])

    await waitFor(() => expect(push).toHaveBeenCalledWith('?page=2'))
    expect(fetch).toHaveBeenCalledWith(
      '/api/announcements',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('shows a published announcement immediately on page 1', async () => {
    renderPanel()
    typeDraft('nytt meddelande')

    fireEvent.click(screen.getByText('communication.publish'))

    await waitFor(() => expect(screen.getByText('nytt meddelande')).toBeDefined())
    expect(push).not.toHaveBeenCalled()
  })

  // On any other page the new announcement belongs on page 1, so prepending it
  // where the user is standing would put it in the wrong place.
  it('returns to page 1 after publishing from a later page', async () => {
    renderPanel({ page: 3 })
    typeDraft('nytt meddelande')

    fireEvent.click(screen.getByText('communication.publish'))

    await waitFor(() => expect(push).toHaveBeenCalledWith('?page=1'))
    expect(screen.queryByText('nytt meddelande')).toBeNull()
  })

  it('distinguishes past-the-end from nothing published', () => {
    renderPanel({
      page: 2,
      announcements: { participants: [], officials: [] },
    })

    expect(screen.getByText('communication.noOlderAnnouncements')).toBeDefined()
    expect(screen.queryByText('communication.noAnnouncementsYet')).toBeNull()

    fireEvent.click(screen.getByText('communication.backToNewest'))

    expect(push).toHaveBeenCalledWith('?page=1')
  })

  it('shows the nothing-published state on page 1', () => {
    renderPanel({ announcements: { participants: [], officials: [] } })

    expect(screen.getByText('communication.noAnnouncementsYet')).toBeDefined()
    expect(screen.queryByText('communication.noOlderAnnouncements')).toBeNull()
  })
  // Paging is a soft navigation: the server component re-renders and hands this
  // same client instance new props. Nothing remounts, so a panel that copied the
  // payload into state on mount would keep rendering page 1 forever.
  it('renders the new server payload after a page change', () => {
    const { rerender } = renderPanel({
      announcements: { participants: [announcement('participants', 0)], officials: [] },
      hasMore: { participants: true, officials: false },
    })

    expect(screen.getByText('participants body 0')).toBeDefined()

    rerender(
      <CommunicationPanel
        tenantId={TENANT_ID}
        page={2}
        announcements={{ participants: [announcement('participants', 5)], officials: [] }}
        hasMore={{ participants: false, officials: false }}
      />
    )

    expect(screen.getByText('participants body 5')).toBeDefined()
    expect(screen.queryByText('participants body 0')).toBeNull()
  })

  it('drops the optimistic row once the server payload carries it', async () => {
    const { rerender } = renderPanel({
      announcements: { participants: [], officials: [] },
    })

    typeDraft('fresh announcement')
    fireEvent.click(screen.getByText('communication.publish'))

    await waitFor(() => expect(screen.getByText('fresh announcement')).toBeDefined())

    const fromServer = { ...announcement('participants', 0), body: 'fresh announcement' }
    rerender(
      <CommunicationPanel
        tenantId={TENANT_ID}
        page={1}
        announcements={{ participants: [fromServer], officials: [] }}
        hasMore={{ participants: false, officials: false }}
      />
    )

    expect(screen.getAllByText('fresh announcement')).toHaveLength(1)
  })
})
