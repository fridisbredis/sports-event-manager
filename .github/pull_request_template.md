<!--
Keep this short. Screen ID (EVT-01), quality-requirement ID (F-SEC-08), or
Trello card in the title or below, so the change is traceable later.
-->

## What and why

<!-- What changed, and what problem it solves. -->

## How it was verified

<!-- What you actually ran or clicked — not what should work in theory. -->

## Database migrations

Delete this section if the PR adds no migration.

- [ ] The migration has a filled-in `Forward-fix:` block (`additive` /
      `destructive` / `replace`) — see `.claude/CLAUDE.md` → "Forward-fix plan"
- [ ] The `Data:` line states something verified, not a guess. For a
      `destructive` migration it names where the original data lives (PITR
      window, export file) or says outright that the loss is accepted
- [ ] `npm run db:types` was run and `src/types/app.ts` updated
- [ ] New tenant-scoped tables follow the RLS convention, including the
      mandatory `is_system_admin()` OR clause

**Reviewer:** CI only checks that the `Forward-fix:` line exists. Whether the
`Data:` line is _true_ is yours to judge.
