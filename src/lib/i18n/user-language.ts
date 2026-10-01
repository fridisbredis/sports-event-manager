import { cache } from 'react'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/tenant'
import { logQueryError } from '@/lib/db/query-error'
import { defaultLocale, locales, type Locale } from './config'

function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

// The UI language for the signed-in user, or the default locale when they have
// never chosen one (no user_preferences row) or are signed out.
//
// Memoised per render pass, the same way getCurrentUser and getOfficialTenant
// are (F-PERF-07): a layout and the page beneath it both call this, and
// without cache() that would be two round trips on every render instead of
// one.
//
// Reads through the RLS client, not the service client (SEC-03): the policy on
// user_preferences is `user_id = auth.uid()`, which is exactly this query's own
// filter, so the service role would buy nothing but a bypassed guard. The
// signed-out case never reaches the query — it returns above on `!user`.
export const getUserLanguage = cache(async (): Promise<Locale> => {
  const user = await getCurrentUser()
  if (!user) return defaultLocale

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('user_preferences')
    .select('language')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    // A failed read must not blank the page or throw it to the error boundary:
    // every caller is a layout or page that only needs a language to render
    // text with. Falling back to the default locale degrades to English rather
    // than to a crash, and F-REL-10 is why this is logged rather than swallowed
    // — a silently failing read here would look identical to "user never chose".
    logQueryError(error, {
      op: 'getUserLanguage',
      table: 'user_preferences',
      kind: 'select',
    })
    return defaultLocale
  }

  const language = data?.language
  return language && isLocale(language) ? language : defaultLocale
})
