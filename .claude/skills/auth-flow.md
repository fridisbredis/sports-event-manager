ROLE:
Auth specialist for this project — Supabase Phone OTP via Twilio, Next.js App Router, multi-tenant RLS.

AUTH ARCHITECTURE:
- Login: phone number → SMS OTP via Twilio (dev: Swedish number +46728101619)
- Verification: Supabase Auth verifies OTP and issues session
- Session: stored in cookies via @supabase/ssr, server-side via createSupabaseServerClient()
- Post-login routing: redirects based on role in user_roles table
- Prod testing: Supabase Test Phone Numbers bypass Twilio (remove before real users)

SCREENS:
- AUTH-01: Enter phone number → sendOtp()
- AUTH-02: Enter OTP code → verifyOtp() → redirect by role

CORE FUNCTIONS:
- sendOtp(phone)
  -> supabase.auth.signInWithOtp({ phone })

- verifyOtp(phone, token)
  -> supabase.auth.verifyOtp({ phone, token, type: 'sms' })

- getUser() — always use this, never getSession() for auth checks
  -> supabase.auth.getUser()

SESSION RULES:
- Use createSupabaseServerClient() (src/lib/supabase/server.ts) in Server Components and route handlers
- Use createSupabaseBrowserClient() in Client Components
- Never expose SUPABASE_SERVICE_ROLE_KEY to the browser — only NEXT_PUBLIC_* vars are safe client-side
- Session persists via cookies — @supabase/ssr handles this automatically

POST-LOGIN ROUTING:
- tenant_admin → /[tenantSlug]/admin/dashboard
- official → /[tenantSlug]/home
- participant → /[tenantSlug]/home
- system_admin → /system/dashboard
- Role is read from user_roles table (not JWT metadata — never use user_metadata for auth decisions)

AUTHORIZATION HELPER:
- src/lib/auth/tenant.ts → requireTenantAdmin(tenantId) and hasAdminAccessToTenant(userId, tenantId)
- Use requireTenantAdmin() in route handlers — returns { user, role } or { error: NextResponse }

COMMON BUGS:
- OTP success but no session: cookie not set — check @supabase/ssr middleware config
- Session lost after reload: proxy not refreshing session — verify proxy.ts runs on all protected routes
- Double verification error: Twilio + Supabase mismatch — ensure OTP type is 'sms' not 'phone_change'
- Wrong redirect after login: user_roles row missing for user — check DB insert on first login

ERROR HANDLING:
- 403 → auth mismatch or missing user_roles row
- 422 → invalid OTP format, expired token, or wrong type param
- "Invalid login credentials" → OTP already used or expired (60s window in dev)
