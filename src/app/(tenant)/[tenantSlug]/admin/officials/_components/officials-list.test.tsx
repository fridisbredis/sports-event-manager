import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { Children, isValidElement } from 'react'
import type { ReactNode, KeyboardEvent } from 'react'
import OfficialsList from './officials-list'
import { toastError } from '@/lib/toast'
import { logger } from '@/lib/logger'
import type { OfficialListItem } from '@/types/app'

// Shared translate stub: returns the i18n key, or `key:JSON(vars)` when vars are
// passed, so assertions can check both the key used and the interpolation values
// without depending on real translation strings. Declared via vi.hoisted so it can
// be referenced both inside the hoisted vi.mock factory and in test assertions.
const { fakeT } = vi.hoisted(() => {
  const fakeT = (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key
  return { fakeT }
})

vi.mock('@/lib/i18n/client', () => ({
  useTranslation: () => ({ t: fakeT }),
}))

vi.mock('@/lib/toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/toast')>()
  return {
    ...actual,
    toastError: vi.fn(),
  }
})

// The real logger writes a JSON line to stderr and reports to Sentry. Stubbed
// both to keep the unexpected-status test's output clean and so the test can
// assert that branch actually logs.
const { routerRefresh, makeTenantAdmin, removeTenantAdmin } = vi.hoisted(() => ({
  routerRefresh: vi.fn(),
  makeTenantAdmin: vi.fn(),
  removeTenantAdmin: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}))

// The real module is a 'use server' file that reaches Supabase; the component
// only needs to call it and act on { error }.
vi.mock('../actions', () => ({ makeTenantAdmin, removeTenantAdmin }))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// HeroUI's real components rely on react-aria overlays/portals and framer-motion,
// which aren't set up in this jsdom environment and aren't the point of these
// tests. Stand in with plain DOM elements that preserve the props the component
// under test actually depends on (onPress, value/onValueChange, isInvalid/errorMessage,
// isOpen).
vi.mock('@heroui/react', () => {
  const Button = ({
    children,
    onPress,
    isDisabled,
    isLoading,
  }: {
    children?: ReactNode
    onPress?: () => void
    isDisabled?: boolean
    isLoading?: boolean
  }) => (
    <button
      type="button"
      disabled={isDisabled}
      data-loading={isLoading}
      onClick={() => onPress?.()}
    >
      {children}
    </button>
  )

  const Chip = ({ children }: { children?: ReactNode }) => <span>{children}</span>

  const Table = ({
    children,
    'aria-label': ariaLabel,
  }: {
    children?: ReactNode
    'aria-label'?: string
  }) => <table aria-label={ariaLabel}>{children}</table>
  const TableHeader = ({ children }: { children?: ReactNode }) => (
    <thead>
      <tr>{children}</tr>
    </thead>
  )
  const TableColumn = ({ children }: { children?: ReactNode }) => <th>{children}</th>
  const TableBody = ({ children }: { children?: ReactNode }) => <tbody>{children}</tbody>

  // The real table is backed by React Stately, which sums `colSpan ?? 1` over
  // a row's cells and throws unless the total equals the column count. A stub
  // that simply rendered its children let a row with four cells AND a
  // colSpan={4} — seven columns' worth — pass every test here and then throw
  // in the browser on first open. This reproduces the rule so that cannot
  // happen again; COLUMN_COUNT tracks the TableHeader above.
  const COLUMN_COUNT = 4
  const TableRow = ({ children }: { children?: ReactNode }) => {
    let columns = 0
    Children.forEach(children, (node) => {
      if (!isValidElement(node)) return
      const { colSpan } = node.props as { colSpan?: number }
      columns += colSpan ?? 1
    })
    if (columns !== COLUMN_COUNT) {
      throw new Error(
        `Cell count must match column count. Found ${columns} cells and ${COLUMN_COUNT} columns.`
      )
    }
    return <tr>{children}</tr>
  }
  // colSpan and id are passed through: N17's detail row is one spanning cell
  // whose id is the aria-controls target of the row's disclosure button, so a
  // stub that dropped them would hide exactly what those tests assert.
  const TableCell = ({
    children,
    colSpan,
    id,
  }: {
    children?: ReactNode
    colSpan?: number
    id?: string
  }) => (
    <td colSpan={colSpan} id={id}>
      {children}
    </td>
  )

  const Modal = ({ isOpen, children }: { isOpen?: boolean; children?: ReactNode }) =>
    isOpen ? <div>{children}</div> : null
  const ModalContent = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const ModalHeader = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const ModalBody = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const ModalFooter = ({ children }: { children?: ReactNode }) => <div>{children}</div>

  const SelectItem = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const Select = ({ label, children }: { label?: ReactNode; children?: ReactNode }) => (
    <div>
      {label}
      {children}
    </div>
  )

  const Input = ({
    label,
    value,
    onValueChange,
    placeholder,
    type,
    description,
    onKeyDown,
    onBlur,
    isInvalid,
    errorMessage,
    autoFocus,
  }: {
    label?: ReactNode
    value?: string
    onValueChange?: (value: string) => void
    placeholder?: string
    type?: string
    description?: ReactNode
    onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
    onBlur?: () => void
    isInvalid?: boolean
    errorMessage?: ReactNode
    autoFocus?: boolean
  }) => (
    <div>
      <label>{label}</label>
      <input
        aria-label={typeof label === 'string' ? label : undefined}
        type={type ?? 'text'}
        value={value ?? ''}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onValueChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        // Forwarded because validation timing depends on it: a stub that
        // dropped onBlur would let blur-gated error display pass every test
        // here and do nothing in the browser.
        onBlur={onBlur}
      />
      {description}
      {isInvalid && errorMessage ? <span role="alert">{errorMessage}</span> : null}
    </div>
  )

  const Card = ({ children }: { children?: ReactNode }) => <div>{children}</div>

  // N27's row menu. Items render as always-visible buttons named by their
  // label, so a test clicks "officials.remove" the same way whether it sits
  // in a menu or not; disabledKeys and onAction keep their real meaning. The
  // description sits outside the button so it does not change its name.
  const Dropdown = ({ children }: { children?: ReactNode }) => <div>{children}</div>
  const DropdownTrigger = ({ children }: { children?: ReactNode }) => <>{children}</>
  const DropdownItem = () => null
  const DropdownMenu = ({
    children,
    onAction,
    disabledKeys,
  }: {
    children?: ReactNode
    onAction?: (key: string) => void
    disabledKeys?: string[]
  }) => (
    <div>
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return null
        const key = String(child.key)
        const props = child.props as { children?: ReactNode; description?: ReactNode }
        return (
          <div>
            <button
              type="button"
              disabled={disabledKeys?.includes(key)}
              onClick={() => onAction?.(key)}
            >
              {props.children}
            </button>
            {props.description ? <span>{props.description}</span> : null}
          </div>
        )
      })}
    </div>
  )
  const CardBody = ({ children }: { children?: ReactNode }) => <div>{children}</div>

  return {
    Button,
    Dropdown,
    DropdownTrigger,
    DropdownMenu,
    DropdownItem,
    Chip,
    Table,
    TableHeader,
    TableColumn,
    TableBody,
    TableRow,
    TableCell,
    Modal,
    ModalContent,
    ModalHeader,
    ModalBody,
    ModalFooter,
    SelectItem,
    Select,
    Input,
    Textarea: Input,
    TimeInput: Input,
    DateRangePicker: Input,
    Card,
    CardBody,
  }
})

const currentUserId = 'user-me'

const officials: OfficialListItem[] = [
  {
    id: 'off-me',
    tenant_id: 'tenant-1',
    name: 'Me Admin',
    phone: '46700000000',
    invite_status: 'confirmed',
    user_id: currentUserId,
    sms_opt_out: false,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'off-1',
    tenant_id: 'tenant-1',
    name: 'Jane Referee',
    phone: '46700000001',
    invite_status: 'invited',
    user_id: null,
    sms_opt_out: false,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
  },
]

function makeResponse(
  status: number,
  opts: { ok?: boolean; retryAfter?: string; json?: unknown } = {}
): Response {
  return {
    ok: opts.ok ?? (status >= 200 && status < 300),
    status,
    headers: {
      get: (name: string) => (name === 'Retry-After' ? (opts.retryAfter ?? null) : null),
    },
    json: async () => opts.json ?? {},
  } as unknown as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof global.fetch
})

async function openAddModalAndFillValidForm() {
  fireEvent.click(screen.getByRole('button', { name: 'officials.add' }))

  const nameInput = screen.getByLabelText('officials.name')
  const phoneInput = screen.getByLabelText('officials.phone')

  fireEvent.change(nameInput, { target: { value: 'New Official' } })
  fireEvent.change(phoneInput, { target: { value: '0701234567' } })

  return screen.getByRole('button', { name: 'officials.sendInvite' })
}

describe('OfficialsList — phone validation timing', () => {
  // The bug: the field turned red on the third keystroke of a number the user
  // was still typing. Every valid number passes through invalid prefixes, so
  // per-keystroke validation complains about input that is merely incomplete.
  function openAddModalWithPartialPhone(value: string) {
    fireEvent.click(screen.getByRole('button', { name: 'officials.add' }))
    const phoneInput = screen.getByLabelText('officials.phone')
    fireEvent.change(phoneInput, { target: { value } })
    return phoneInput
  }

  const renderList = () =>
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

  it('stays silent while an incomplete number is still being typed', () => {
    renderList()
    openAddModalWithPartialPhone('768')

    expect(screen.queryByText('officials.invalidPhone')).not.toBeInTheDocument()
  })

  it('shows the error once the field is left still invalid', async () => {
    renderList()
    const phoneInput = openAddModalWithPartialPhone('768')

    fireEvent.blur(phoneInput)

    expect(await screen.findByText('officials.invalidPhone')).toBeInTheDocument()
  })

  it('stays silent when the field is left holding a valid number', () => {
    renderList()
    const phoneInput = openAddModalWithPartialPhone('0701234567')

    fireEvent.blur(phoneInput)

    expect(screen.queryByText('officials.invalidPhone')).not.toBeInTheDocument()
  })

  it('stays silent when an untouched empty field is left', () => {
    renderList()
    const phoneInput = openAddModalWithPartialPhone('')

    fireEvent.blur(phoneInput)

    // Leaving a field you never filled is not an error worth colouring red —
    // the disabled submit button already says the form is incomplete.
    expect(screen.queryByText('officials.invalidPhone')).not.toBeInTheDocument()
  })

  it('forgets it was touched when the modal is reopened', async () => {
    renderList()
    const phoneInput = openAddModalWithPartialPhone('768')
    fireEvent.blur(phoneInput)
    expect(await screen.findByText('officials.invalidPhone')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'officials.cancel' }))
    await waitFor(() => expect(screen.queryByLabelText('officials.phone')).not.toBeInTheDocument())

    // A fresh form must start clean. Without resetting phoneTouched, the next
    // invite would go red on the first keystroke — the original bug, restored.
    openAddModalWithPartialPhone('768')
    expect(screen.queryByText('officials.invalidPhone')).not.toBeInTheDocument()
  })
})

describe('OfficialsList — handleAdd error branches', () => {
  it('409: shows duplicate-phone toast and marks the phone field invalid', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(409))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(fakeT('officials.duplicatePhone')))
    expect(screen.getByRole('alert')).toHaveTextContent('officials.duplicatePhone')
  })

  it('400: shows invalid-phone toast and marks the phone field invalid', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(400))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(fakeT('officials.invalidPhone')))
    expect(screen.getByRole('alert')).toHaveTextContent('officials.invalidPhone')
  })

  it('503: shows service-unavailable toast and does not mark the phone field invalid', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(503))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(fakeT('officials.addServiceUnavailable'))
    )
    expect(screen.queryByRole('alert')).toBeNull()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/officials',
      expect.objectContaining({ body: expect.stringContaining('"tenantId":"tenant-1"') })
    )
  })

  it('401: shows session-expired toast and marks the phone field invalid', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(401))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(fakeT('officials.sessionExpired')))
    expect(screen.getByRole('alert')).toHaveTextContent('officials.sessionExpired')
  })

  it('429 with numeric Retry-After: 90 seconds rounds up to 2 minutes', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(429, { retryAfter: '90' }))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        fakeT('officials.addRateLimited', { count: 2, minutes: 2 })
      )
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('429 with no Retry-After header falls back to 60 seconds / 1 minute', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(429))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        fakeT('officials.addRateLimited', { count: 1, minutes: 1 })
      )
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('404: falls into the generic branch and toasts a safe generic message instead of the raw server error', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(404, {
        json: { error: 'Duplicate key value violates constraint officials_phone_tenant_idx' },
      })
    )
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(fakeT('officials.addUnexpectedError'))
    )
    expect(screen.getByRole('alert')).toHaveTextContent('officials.addUnexpectedError')
    // The raw server message is logged for diagnosis but kept off the screen.
    expect(logger.error).toHaveBeenCalledWith(
      'Unexpected /api/officials error response',
      undefined,
      {
        status: 404,
        message: 'Duplicate key value violates constraint officials_phone_tenant_idx',
      }
    )
  })
})

describe('OfficialsList — handleAdd success', () => {
  const created: OfficialListItem = {
    id: 'off-new',
    tenant_id: 'tenant-1',
    name: 'New Official',
    phone: '46701234567',
    invite_status: 'invited',
    user_id: null,
    sms_opt_out: false,
    avatar_url: null,
    created_at: '2026-01-01T00:00:00Z',
  }

  it('200 with smsSent false: still appends the official, then toasts the SMS failure', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, { json: { official: created, smsSent: false } })
    )
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    // The row appearing is the point: the official was created server-side, so
    // a failed invite SMS must not make them vanish from the list.
    await waitFor(() => expect(screen.getByText('New Official')).toBeInTheDocument())
    expect(toastError).toHaveBeenCalledWith(
      fakeT('officials.addedSmsFailed', { name: 'New Official' })
    )
  })

  it('200 with smsSent true: appends the official and toasts nothing', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(200, { json: { official: created, smsSent: true } })
    )
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    const sendButton = await openAddModalAndFillValidForm()
    fireEvent.click(sendButton)

    await waitFor(() => expect(screen.getByText('New Official')).toBeInTheDocument())
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('OfficialsList — handleRemove', () => {
  // Like resend, the row's "remove" button only opens the confirm dialog; the
  // dialog's own "remove"-labeled confirm button triggers the DELETE.
  function clickRemoveAndConfirm() {
    const [rowButton] = screen.getAllByRole('button', { name: 'officials.remove' })
    fireEvent.click(rowButton)

    const confirmButton = screen
      .getAllByRole('button', { name: 'officials.remove' })
      .find((button) => button !== rowButton)
    fireEvent.click(confirmButton!)
  }

  it('failed DELETE: toasts the remove error and leaves the official in the list', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    clickRemoveAndConfirm()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        fakeT('officials.removeError', { name: 'Jane Referee' })
      )
    )
    expect(screen.getByText('Jane Referee')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/officials/off-1?tenantId=tenant-1',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('successful DELETE: drops the official from the list without toasting', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200))
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )

    clickRemoveAndConfirm()

    await waitFor(() => expect(screen.queryByText('Jane Referee')).toBeNull())
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('OfficialsList — handleResend error branches', () => {
  function renderList() {
    render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )
  }

  // Clicking the row's "resendInvite" button only opens the confirm dialog
  // (see officials-list.tsx's resendTarget state); the dialog's own
  // "resendInvite"-labeled confirm button is what actually triggers
  // handleResend, so both clicks are needed to reach the fetch call.
  function clickResendAndConfirm() {
    const [rowButton] = screen.getAllByRole('button', { name: 'officials.resendInvite' })
    fireEvent.click(rowButton)

    const confirmButton = screen
      .getAllByRole('button', { name: 'officials.resendInvite' })
      .find((button) => button !== rowButton)
    fireEvent.click(confirmButton!)
  }

  it('400: shows official-unavailable toast', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(400))
    renderList()

    clickResendAndConfirm()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(fakeT('officials.resendOfficialUnavailable'))
    )
  })

  it('401: shows session-expired toast', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(401))
    renderList()

    clickResendAndConfirm()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(fakeT('officials.sessionExpired')))
  })

  it('503: shows resend-service-unavailable toast', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(503))
    renderList()

    clickResendAndConfirm()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(fakeT('officials.resendServiceUnavailable'))
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/officials/off-1/resend',
      expect.objectContaining({ body: expect.stringContaining('"tenantId":"tenant-1"') })
    )
  })

  it('429 with Retry-After: 90 seconds rounds up to 2 minutes', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(429, { retryAfter: '90' }))
    renderList()

    clickResendAndConfirm()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        fakeT('officials.resendRateLimited', { count: 2, minutes: 2 })
      )
    )
  })

  it('502: shows the dead-link resend error, distinct from the generic config error', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(502))
    renderList()

    clickResendAndConfirm()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        fakeT('officials.resendError', { name: 'Jane Referee' })
      )
    )
  })

  it('500: shows the generic config error, not the 502 dead-link message', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500))
    renderList()

    clickResendAndConfirm()

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(fakeT('officials.resendConfigError'))
    )
    expect(toastError).not.toHaveBeenCalledWith(
      fakeT('officials.resendError', { name: 'Jane Referee' })
    )
  })
})

describe('OfficialsList — N17 expanded row', () => {
  const details = {
    'off-1': {
      shifts: [
        {
          start: '2026-08-02T08:00:00Z',
          end: '2026-08-02T11:00:00Z',
          workAreaName: 'Finish line',
        },
      ],
      timeOff: [
        {
          id: 'p-1',
          startsAt: '2026-08-01T00:00:00Z',
          endsAt: '2026-08-02T00:00:00Z',
          reason: 'Away',
          createdByRole: 'official',
        },
      ],
    },
  }

  function renderList() {
    return render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={officials}
        currentUserId={currentUserId}
        details={details}
        language="en"
        adminUserIds={[]}
        adminCap={10}
        tier="professional"
      />
    )
  }

  // The panel is absent, not hidden: a collapsed row must not put the
  // official's shifts into the accessibility tree or into Cmd+F, where their
  // presence would imply the row is already open.
  it('renders no detail panel until the row is expanded', () => {
    renderList()

    expect(screen.queryByText('Finish line')).not.toBeInTheDocument()
  })

  it('shows shifts and time off after clicking the name, and hides them again', () => {
    renderList()

    const toggle = screen.getByRole('button', { name: /Jane Referee/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Finish line')).toBeInTheDocument()
    expect(screen.getByText(/Away/)).toBeInTheDocument()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Finish line')).not.toBeInTheDocument()
  })

  // Two rows open at once is the point of a Set rather than a single id:
  // comparing two officials' shifts is the reason an admin opens these.
  it('keeps several rows open at the same time', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: /Jane Referee/ }))
    fireEvent.click(screen.getByRole('button', { name: /Me Admin/ }))

    expect(screen.getByRole('button', { name: /Jane Referee/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('button', { name: /Me Admin/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
  })

  // An official with nothing scheduled still gets a panel, with wording that
  // says so — the same copy a failed read falls back to.
  it('renders empty-state copy for an official with no shifts or time off', () => {
    renderList()

    fireEvent.click(screen.getByRole('button', { name: /Me Admin/ }))

    expect(screen.getByText('officials.detailNoShifts')).toBeInTheDocument()
    expect(screen.getByText('officials.detailNoTimeOff')).toBeInTheDocument()
  })

  // The disclosure button must point at the panel it opens.
  it('ties the toggle to the panel it controls', () => {
    renderList()

    const toggle = screen.getByRole('button', { name: /Jane Referee/ })
    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-controls', 'official-detail-off-1')
    expect(document.getElementById('official-detail-off-1')).toBeInTheDocument()
  })
})

describe('OfficialsList — N27 admin role', () => {
  const roster: OfficialListItem[] = [
    officials[0],
    {
      id: 'off-admin',
      tenant_id: 'tenant-1',
      name: 'Ada Admin',
      phone: '46700000002',
      invite_status: 'confirmed',
      user_id: 'user-admin',
      sms_opt_out: false,
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'off-conf',
      tenant_id: 'tenant-1',
      name: 'Carl Confirmed',
      phone: '46700000003',
      invite_status: 'confirmed',
      user_id: 'user-conf',
      sms_opt_out: false,
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
    },
    // Invited: cannot be made admin until they confirm.
    officials[1],
  ]

  // Three admins of three on Premium when the cap is reached; two of ten
  // on Professional otherwise.
  function renderList({ capReached = false } = {}) {
    return render(
      <OfficialsList
        tenantSlug="acme"
        tenantId="tenant-1"
        officials={roster}
        currentUserId={currentUserId}
        details={{}}
        language="en"
        adminUserIds={
          capReached
            ? [currentUserId, 'user-admin', 'user-elsewhere']
            : [currentUserId, 'user-admin']
        }
        adminCap={capReached ? 3 : 10}
        tier={capReached ? 'premium' : 'professional'}
      />
    )
  }

  function rowOf(name: string) {
    return screen.getByRole('button', { name: new RegExp(name) }).closest('tr') as HTMLElement
  }

  function adminLinkIn(name: string, label = 'officials.makeAdmin') {
    return within(rowOf(name)).getByRole('button', { name: label })
  }

  it('badges admins and offers the matching role action per row', () => {
    renderList()

    const admin = rowOf('Ada Admin')
    expect(admin).toHaveTextContent('officials.adminBadge')
    expect(admin).toHaveTextContent('officials.removeAdminRole')
    // Removing an admin from the roster would leave their admin access in
    // place, so the role has to go first.
    expect(Array.from(admin.querySelectorAll('button')).map((b) => b.textContent)).not.toContain(
      'officials.remove'
    )

    expect(rowOf('Carl Confirmed')).not.toHaveTextContent('officials.adminBadge')
    expect(adminLinkIn('Carl Confirmed')).toBeEnabled()

    // On every row, but greyed out with the reason until the official has
    // confirmed: only a confirmed official can be made admin.
    expect(adminLinkIn('Jane Referee')).toBeDisabled()
    expect(
      within(rowOf('Jane Referee')).getByText('officials.makeAdminRequiresConfirmed')
    ).toBeInTheDocument()
  })

  it('explains the cap with the tier, the limit and how many are in use', () => {
    renderList()

    expect(
      screen.getByText(
        `officials.adminCapHint:${JSON.stringify({ count: 10, used: 2, tier: 'systemAdmin.professional:{"defaultValue":"professional"}' })}`
      )
    ).toBeInTheDocument()
  })

  it("offers no role action on the current user's own row", () => {
    renderList()

    const me = rowOf('Me Admin')
    expect(me).toHaveTextContent('officials.adminBadge')
    expect(me).not.toHaveTextContent('officials.removeAdminRole')
  })

  it('greys promotion out rather than hiding it once the cap is reached, but still allows removal', () => {
    renderList({ capReached: true })

    expect(screen.getByText(/officials\.adminCapReachedHint/)).toBeInTheDocument()
    expect(adminLinkIn('Carl Confirmed')).toBeDisabled()
    expect(adminLinkIn('Jane Referee')).toBeDisabled()
    expect(adminLinkIn('Ada Admin', 'officials.removeAdminRole')).toBeEnabled()
  })

  it('promotes after confirmation and re-reads the roster', async () => {
    makeTenantAdmin.mockResolvedValue({})
    renderList()

    fireEvent.click(adminLinkIn('Carl Confirmed'))
    expect(makeTenantAdmin).not.toHaveBeenCalled()

    // The dialog's confirm button carries the same label as the row action.
    const buttons = screen.getAllByRole('button', { name: 'officials.makeAdmin' })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() =>
      expect(makeTenantAdmin).toHaveBeenCalledWith({
        tenantSlug: 'acme',
        tenantId: 'tenant-1',
        officialId: 'off-conf',
      })
    )
    await waitFor(() => expect(routerRefresh).toHaveBeenCalled())
    expect(toastError).not.toHaveBeenCalled()
  })

  it("shows the server's refusal when removing the role fails", async () => {
    removeTenantAdmin.mockResolvedValue({ error: 'Last admin' })
    renderList()

    fireEvent.click(screen.getByRole('button', { name: 'officials.removeAdminRole' }))
    const buttons = screen.getAllByRole('button', { name: 'officials.removeAdminRole' })
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Last admin'))
    expect(removeTenantAdmin).toHaveBeenCalledWith({
      tenantSlug: 'acme',
      tenantId: 'tenant-1',
      officialId: 'off-admin',
    })
  })
})
