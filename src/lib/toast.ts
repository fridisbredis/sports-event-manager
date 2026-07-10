import { addToast } from '@heroui/react'

export function toastError(description: string, title?: string) {
  addToast({ title, description, color: 'danger', timeout: 5000 })
}

export function toastSuccess(description: string, title?: string) {
  addToast({ title, description, color: 'success', timeout: 3000 })
}

/**
 * API routes return errors as either a plain string or a Zod `.flatten()`
 * object ({formErrors, fieldErrors}) — this picks a displayable message from either.
 */
export function extractErrorMessage(body: unknown, fallback: string): string {
  const error = (body as { error?: unknown } | undefined)?.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const flat = error as { formErrors?: string[]; fieldErrors?: Record<string, string[]> }
    if (flat.formErrors?.[0]) return flat.formErrors[0]
    const firstField = Object.values(flat.fieldErrors ?? {}).find((v) => v?.length)
    if (firstField?.[0]) return firstField[0]
  }
  return fallback
}
