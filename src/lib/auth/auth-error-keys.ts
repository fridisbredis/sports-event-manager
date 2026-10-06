// GoTrue error codes → translation keys in the `auth` namespace.
//
// Shared rather than per-page: the sign-in page and the invite form both call
// signInWithOtp against the same provider and so can receive exactly the same
// codes. When this lived only in login/page.tsx the invite form had no mapping
// at all and fell back to showing Supabase's raw `error.message` — English,
// worded for developers, and a raw provider string reaching the client.
//
// `otp_expired` covers both a mistyped and an expired code — GoTrue does not
// distinguish them, so the message must work for both cases.
export const AUTH_ERROR_KEYS: Record<string, string> = {
  otp_expired: 'signIn.invalidCode',
  over_sms_send_rate_limit: 'signIn.tooManyRequests',
  over_request_rate_limit: 'signIn.tooManyRequests',
  signup_disabled: 'signIn.notRegistered',
}

// The key to show for a given provider error code, falling back to the generic
// message for an unmapped or absent code. Callers pass the result to `t()`;
// centralising the fallback is what keeps an unrecognised code from reaching
// the user as provider text.
export function authErrorKey(code: string | undefined): string {
  return AUTH_ERROR_KEYS[code ?? ''] ?? 'signIn.error'
}

// Whether a provider error code is one the user caused and the UI already
// explains — a mistyped code, too many attempts, a number that is not
// registered. These are the normal failure paths of a login form, not faults:
// logging them at error level sends every wrong digit to Sentry (logger.error
// reports there, REL-02) and buries real breakage in noise. Callers log these
// at warn and keep error for codes this map does not know.
export function isExpectedAuthError(code: string | undefined): boolean {
  return code !== undefined && code in AUTH_ERROR_KEYS
}
