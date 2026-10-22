Context:
@context.md
@skills/auth-flow.md

Plan first (before anything else):

- Call EnterPlanMode as the very first action of this command, before reading
  files or running anything. Don't skip it because the task looks small, and
  don't ask whether to plan — just enter.
- If plan mode is already active, this is a no-op. Entering twice is harmless;
  not entering is the failure mode this guards against.
- Then explore, and present the plan for approval via ExitPlanMode. No edits,
  migrations or commands that change state until the plan is approved.

Task:
Fix the auth issue.

Code:
{{selection}}

Error:
{{error}}

Checklist:

- OTP sent but no session created → check @supabase/ssr middleware config, cookies being set
- Session lost after reload → verify src/proxy.ts runs on protected routes and calls supabase.auth.getUser()
- Wrong redirect after login → check user_roles row exists + resolvePostLoginRedirect() in src/lib/auth/tenant.ts (system_admin → /admin, participant → /[slug]/participant)
- getSession() used instead of getUser() → always use getUser() for auth checks
- "Invalid login credentials" → OTP expired (60s) or already used
- Twilio sending but Supabase rejecting → OTP type must be 'sms', not 'phone_change'
- Prod login not working → check if Supabase Test Phone Number entry is interfering
- RLS blocking after login → is_system_admin() missing from policy, or user_roles row missing
- Official surfaces empty despite a role → officials row missing or invite_status != 'confirmed'

Tests (Vitest):

- If the bug is in testable logic (routing decisions, role checks, data shaping), add a regression test co-located as `<filename>.test.ts`, following `src/lib/scheduling/grid-logic.test.ts` as the convention
- Skip tests for issues that only manifest via live Twilio/Supabase auth flows — note that manual verification is required instead
- Run `npm test` to confirm

Output:

- Root cause
- Minimal fix
- Regression test (or note on why one isn't feasible)
