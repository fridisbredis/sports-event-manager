'use client'

// The design renders "Resend code" and "Use a different number" as plain text
// links, not as buttons — they sit below the primary action with no surface of
// their own. They are still real controls, so they stay <button> elements for
// keyboard and screen-reader behaviour; only the painting is link-like.
//
// Disabled state covers the resend cooldown: the label keeps its place in the
// layout while it counts down, so the block doesn't shift when it re-enables.
interface LinkActionProps {
  onPress: () => void
  isDisabled?: boolean
  children: React.ReactNode
}

export function LinkAction({ onPress, isDisabled = false, children }: LinkActionProps) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={isDisabled}
      className="mx-auto block rounded-md px-2 py-1 text-base font-semibold text-ink transition-colors hover:text-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:pointer-events-none disabled:font-normal disabled:text-ink-faint"
    >
      {children}
    </button>
  )
}
