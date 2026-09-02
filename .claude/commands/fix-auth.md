Context:
@context.md
@skills/auth-flow.md

Task:
Fix the auth issue.

Code:
{{selection}}

Error:
{{error}}

Checklist:

- OTP sent but no session created → check @supabase/ssr middleware config, cookies being set
- Session lost after reload → verify proxy.ts runs on protected routes and calls supabase.auth.getUser()
- Wrong redirect after login → check user_roles row exists for user + role-based routing logic
- getSession() used instead of getUser() → always use getUser() for auth checks
- "Invalid login credentials" → OTP expired (60s) or already used
- Twilio sending but Supabase rejecting → OTP type must be 'sms', not 'phone_change'
- Prod login not working → check if Supabase Test Phone Number entry is interfering
- RLS blocking after login → is_system_admin() missing from policy, or user_roles row missing

Tests (Vitest):

- If the bug is in testable logic (routing decisions, role checks, data shaping), add a regression test co-located as `<filename>.test.ts`, following `src/lib/scheduling/grid-logic.test.ts` as the convention
- Skip tests for issues that only manifest via live Twilio/Supabase auth flows — note that manual verification is required instead
- Run `npm test` to confirm

Output:

- Root cause
- Minimal fix
- Regression test (or note on why one isn't feasible)
