import { getServerTranslation } from '@/lib/i18n/server'
import { defaultLocale } from '@/lib/i18n/config'

// Server actions return their error message to the client as a plain string,
// which the caller hands straight to toastError(). Before this helper those
// strings were English literals, so a Swedish UI raised English toasts for
// every guard that fired ("Not authorized", "Failed to update tier").
//
// Translating here rather than at each call site keeps the action's return
// type a plain string: the client components that show these already accept
// `result.error` as displayable text and would otherwise each need their own
// key-to-text mapping.
//
// This is for the app's OWN guard messages only. A raw Postgres/PostgREST
// error still goes through translateDbError (F-REL-22) — never forward
// error.message from the database to the client.
export async function translateActionError(key: string): Promise<string> {
  const t = await getServerTranslation(defaultLocale, 'common')
  return t(key)
}
