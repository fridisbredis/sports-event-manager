/**
 * The one place an SMS link is built from NEXT_PUBLIC_APP_URL.
 *
 * Every link we text is unusable if the origin is wrong, and the message has
 * already cost a segment by the time anyone notices. So the rule is: no link,
 * no send. Callers get null and skip the send rather than texting
 * "undefined/invite/<uuid>".
 *
 * Why this is worth guarding at all when the variable is set in both
 * environments today (B9): NEXT_PUBLIC_* is inlined at BUILD time, not read at
 * runtime. A build that misses it produces an image that sends dead links
 * everywhere, and no amount of runtime configuration can correct it — which
 * also means a smoke test against the running container cannot reveal it.
 */

/**
 * Whether the configured origin can produce a working link at all.
 *
 * Separate from buildAppLink so a caller can fail BEFORE doing something
 * destructive it would otherwise have to undo — the invite resend route
 * checks this before rotating the token, since the rotation kills the
 * official's previous link irreversibly.
 */
export function hasUsableAppOrigin(): boolean {
  return process.env.NEXT_PUBLIC_APP_URL?.startsWith('https://') ?? false
}

/**
 * @param path absolute, leading slash, already encoded — e.g. `/invite/<token>`
 * @returns the absolute https URL, or null when the configured origin cannot
 *   produce a working link
 */
export function buildAppLink(path: string): string | null {
  // https only, and absolute. A relative value ('/app') or a plain-http one
  // both yield a link that either cannot be opened from a phone's message
  // list at all, or opens without TLS on a URL that carries an invite token.
  if (!hasUsableAppOrigin()) return null

  const base = process.env.NEXT_PUBLIC_APP_URL!

  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}
