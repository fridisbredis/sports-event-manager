// The cast of test users, and which screens each one exists to exercise.
//
// Every number here has a matching entry under [auth.sms.test_otp] in
// supabase/config.toml with the code '000000' — that is what makes UI sign-in
// possible without a real SMS. Numbers +46709900001..006 are created by
// scripts/seed-dev.ts; +46709900007 is created by tests/e2e/global-setup.ts.
//
// Deliberately disjoint from the integration suite's pool (+46700000001..010,
// see tests/integration/helpers.ts) so the two suites can run against the same
// local stack without stealing each other's users.

export const SEED_TENANT_SLUG = 'seed-klubben'
export const OTP_CODE = '000000'

export const SYSTEM_ADMIN_PHONE = '+46709900007'

export type RoleKey =
  | 'systemAdmin'
  | 'tenantAdmin'
  | 'officialConfirmed'
  | 'officialSingleDay'
  | 'officialNoShifts'

export interface TestUser {
  phone: string
  /** Where resolvePostLoginRedirect sends this user after a successful verify. */
  landingPath: string
  /** Why this user exists — which screens or states it is here to cover. */
  covers: string
}

export const USERS: Record<RoleKey, TestUser> = {
  // System admin — global role, user_roles.tenant_id IS NULL (migration 0021).
  // The only user who can reach SYS-01 / SYS-02.
  systemAdmin: {
    phone: SYSTEM_ADMIN_PHONE,
    landingPath: '/admin',
    covers: 'SYS-01, SYS-02, /admin/health',
  },

  // Tenant admin of seed-klubben. Reaches every admin screen, and per OFF-01 is
  // implicitly a confirmed, schedulable official on the roster.
  tenantAdmin: {
    phone: '+46709900001',
    landingPath: `/${SEED_TENANT_SLUG}/admin/dashboard`,
    covers: 'EVT-01, EVT-02, WS-01, WS-02, OFF-01, SCHED-01, COMM-01, ACCT-01 (admin)',
  },

  // Confirmed official with 4 shifts across the 3 seeded days — the happy path
  // for every official surface.
  officialConfirmed: {
    phone: '+46709900002',
    landingPath: `/${SEED_TENANT_SLUG}/home`,
    covers: 'HOME-01, INFO-01, MYSCH-01 (populated), ANN-01, ACCT-01 (official)',
  },

  // Confirmed official with a single shift on day 0. Exercises MYSCH-01's day
  // selector when only one of the three days has anything in it.
  officialSingleDay: {
    phone: '+46709900005',
    landingPath: `/${SEED_TENANT_SLUG}/home`,
    covers: 'MYSCH-01 single-day case',
  },

  // Confirmed official with no shifts at all — MYSCH-01's empty state, which
  // the spec never documented but which real officials will hit.
  officialNoShifts: {
    phone: '+46709900006',
    landingPath: `/${SEED_TENANT_SLUG}/home`,
    covers: 'MYSCH-01 empty state, ACCT-01 without a schedule section',
  },
}

// Users who exist as data but cannot hold a session, so they are documented
// here rather than in USERS. seed-dev.ts creates officials rows for these
// without auth users; signing in as them would make GoTrue create a fresh
// roleless user (enable_signup = true), which lands on the "not authorized"
// page instead of anything meaningful.
export const NON_LOGIN_FIXTURES = {
  officialInvited: '+46709900003', // invite_status 'invited', drives OFF-01's invited count
  officialRemoved: '+46709900004', // invite_status 'removed'
  participant: '+46709900010', // participants row only; participant screens are deferred in v1
} as const
