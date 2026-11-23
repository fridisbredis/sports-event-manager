# Device and browser test matrix (N62)

Viadal and the tournament flow must work in every browser on every phone (requirement, Frida 2026-11-19). Until now almost everything has been checked on iPhone + Safari only. This file is the matrix that changes that: one row per phone, browser and mode, filled in by hand on real devices.

**Re-run it** before Viadal 2026, and after any change to sign-in, the tournament token or push.

**A failure** becomes its own B card on the task board, linked from the row. **A platform limit** (see [Expected limits](#expected-limits)) is written down as expected, not as a failure.

---

## Before you start

- **Where:** prod, https://app.viadalevent.se. The tournament engine only trusts prod Viadal (ADR-0005, N56), so check 4 cannot be done on dev.
- **Who:** your own account, an official in an event of a premium or professional tenant (the Tournaments card is tier-gated).
- **Open question, decide before check 5:** an announcement sent from a real event goes by SMS (and push) to every official in it. Check 5 needs an event whose only officials are the testers. Which event that is has not been decided yet; until it is, skip check 5 and mark it `skipped`.
- **Record versions** from the phone itself: iOS / Android version (Settings → About), and the browser version (browser's own About page).

## The matrix

Modes: **tab** = the site opened in the browser; **installed** = added to the home screen and opened from its icon.

Result per check: `OK`, `FAIL (B<n>)`, `expected` (a known platform limit), `skipped`, or blank (not run yet).

| #   | Phone   | Browser          | Mode      | OS version | Browser version | Date | Tester | 1 Sign-in | 2 Official screens | 3 Switching | 4 Tournaments | 5 Push | 6 Logout |
| --- | ------- | ---------------- | --------- | ---------- | --------------- | ---- | ------ | --------- | ------------------ | ----------- | ------------- | ------ | -------- |
| A1  | iPhone  | Safari           | tab       |            |                 |      |        |           |                    |             |               |        |          |
| A2  | iPhone  | Safari           | installed |            |                 |      |        |           |                    |             |               |        |          |
| A3  | iPhone  | Chrome           | tab       |            |                 |      |        |           |                    |             |               |        |          |
| A4  | iPhone  | Chrome           | installed |            |                 |      |        |           |                    |             |               |        |          |
| B1  | Android | Chrome           | tab       |            |                 |      |        |           |                    |             |               |        |          |
| B2  | Android | Chrome           | installed |            |                 |      |        |           |                    |             |               |        |          |
| B3  | Android | Samsung Internet | tab       |            |                 |      |        |           |                    |             |               |        |          |
| B4  | Android | Samsung Internet | installed |            |                 |      |        |           |                    |             |               |        |          |
| B5  | Android | Firefox          | tab       |            |                 |      |        |           |                    |             |               |        |          |
| B6  | Android | Firefox          | installed |            |                 |      |        |           |                    |             |               |        |          |

Not enough real phones: borrow, or use BrowserStack (or similar) for the Android rows and say so in the Tester column. Push and SMS autofill only count on a real device.

## What to tap

Run the checks in order in each row. Each one says what should happen; anything else is a `FAIL`.

### 1. Sign-in

1. Open https://app.viadalevent.se (for _installed_: add it to the home screen first, then open it from the icon).
2. Enter your phone number, tap **Send code**.
3. The SMS arrives within a minute. Where the phone offers the code above the keyboard (autofill), use it; note whether it was offered.
4. You land on your start page (the event, or the event picker if you have several).

### 2. Official screens

1. Tap through the bottom tabs: Home, Event info, My schedule, Announcements, Account.
2. Each opens without an error, the bar stays at the bottom, and no content hides behind it at the end of a long page (scroll to the bottom of Account).
3. On My schedule, open **Manage time off**, then close it again.

### 3. Switching surface and organisation (B19, B20)

Only for an account that has more than one role or tenant; otherwise mark `skipped`.

1. System admin + official: from `/admin`, open the menu, **Your tenants** → the tenant → official view. At the top of the official view, **System admin** takes you back.
2. Tenant admin: in the admin menu (the round button bottom right on a phone), **Official view** and back.
3. Roles in two organisations: **Account → Other organisations** lists the other one and opens it; in the admin menu, **Other organisations** does the same.

Everything by tapping only. Having to type a URL is a `FAIL`; in an installed app it is impossible anyway.

### 4. Tournaments

1. On Home, tap the **Tournaments** card.
2. The tournament app opens signed in, in Viadal's colours and in your app language.
3. Leave it open for **15 minutes** (the token's lifetime), then do something in it (open a tournament, change tab).
4. It still works without sending you back to Viadal or showing you as signed out. If it does not, that is the N61 case: note the row and whether Viadal was a tab or installed.

### 5. Push (N31)

Skip until the open question under [Before you start](#before-you-start) is settled.

1. **Account → Push notifications**: turn it on and allow notifications when asked.
2. Someone sends an announcement in the test event.
3. The push arrives; tapping it opens Viadal. The SMS arrives too: push never replaces SMS.
4. Where the toggle says the browser cannot receive push, or tells you to add the app to the home screen, see [Expected limits](#expected-limits) and confirm the SMS still arrives.

### 6. Logout

1. **Account → Log out.** You land on the sign-in page.
2. Tap the browser's back button (Android: the system back gesture). You should not see a signed-in page.

Known: this failed on 2026-08-19 and is not fixed (see `prod-sms-login-checklist.md` §4). Record the result per row anyway; it tells us which browsers are affected.

## Expected limits

Write `expected` for these, not `FAIL`:

- **iPhone, any browser, as a tab:** no push. The toggle shows the hint to add the app to the home screen. The SMS still arrives.
- **Any browser without Web Push:** the toggle says the browser cannot receive push notifications. The SMS still arrives.

Seen once and still to confirm (N31): **Chrome on iPhone** added the icon as a plain bookmark rather than an app. If A4 opens in a Chrome tab instead of standalone, write that in the row and treat push there as `expected`.

## Results log

One line per run, newest first: date, rows run, who, and the B cards opened.

| Date | Rows | Tester | Notes / cards |
| ---- | ---- | ------ | ------------- |
|      |      |        |               |
