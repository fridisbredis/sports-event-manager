#!/usr/bin/env bash
# Which rotation slot (0-3) this week's weekly prod backup goes to. Used by
# .github/workflows/weekly-db-backup.yml; tested by
# scripts/__tests__/backup-slot.test.ts.
#
# USAGE: scripts/ops/backup-slot.sh [unix-seconds]   (default: now)
# Prints two lines in GITHUB_OUTPUT format:
#   slot=<0-3>
#   week=<ISO week number, zero-padded>   -> blob metadata `isoweek`
#
# WHY NOT "ISO WEEK MOD 4" (B23)
# The slot used to be the ISO week number mod 4. A year with 53 ISO weeks
# breaks that: week 53 and the next year's week 1 are both slot 1, so week 1
# overwrites the backup it is supposed to keep for three more weeks. 2026 is
# such a year (week 53 is Sunday 2027-01-03; week 1 runs 2027-01-10), and so
# is 2032.
#
# The slot is now a running week count that never resets at new year: whole
# Monday-to-Sunday weeks since 1970-01-05, the first Monday of the Unix epoch.
# Consecutive weeks always land on consecutive slots.
#
# OFFSET 3 makes the new count give the same slot as the old formula for every
# week of ISO year 2026, so switching over overwrote nothing early: the two
# first differ at 2027-W01, which is the week the old one got wrong.
#
# The ISO week is still reported, for the `isoweek` metadata. The freshness
# alert (N46) and the Backups page (N25) read dates, not slot numbers, so
# neither depends on how the slot is chosen.

set -euo pipefail

OFFSET=3

now="${1:-$(date -u +%s)}"
if ! [[ "$now" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 [unix-seconds]" >&2
  exit 2
fi

# 1970-01-01 was a Thursday, so day N belongs to the Monday-started week
# (N + 3) / 7. Integer division floors for non-negative values.
days=$(( now / 86400 ))
weeks=$(( (days + 3) / 7 ))
slot=$(( (weeks + OFFSET) % 4 ))

# GNU date (the Actions runner) takes -d @N; BSD date (macOS) takes -r N.
week=$(date -u -d "@${now}" +%V 2>/dev/null || date -u -r "${now}" +%V)

echo "slot=${slot}"
echo "week=${week}"
