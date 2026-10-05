#!/usr/bin/env bash
# ==============================================================================
# scripts/check-snapshot-claim.sh
#
# Decides whether ONE migration file classified `Forward-fix: destructive`
# satisfies REL-04's snapshot requirement, and prints the reason.
# (REL-04 is the requirement older comments cite as "F-REL-20".)
#
# Exit 0 = satisfied, exit 1 = not satisfied. Callers aggregate.
#
# Two ways to satisfy it:
#
#   1. A real snapshot filename on the Data: line — the format
#      scripts/ops/snapshot-prod-db.sh prints on success.
#
#   2. A constraint-only exemption: the Data: line claims
#      `no snapshot required (constraint-only)`. Because a claim nobody
#      checks is the same as no gate at all, this script VERIFIES the claim
#      against the migration's actual SQL rather than trusting it — the file
#      must contain no INSERT/UPDATE/DELETE/DROP COLUMN/TRUNCATE outside of
#      comments and function bodies. A migration that writes rows cannot
#      exempt itself no matter what its header says.
#
# Why the exemption exists: `destructive` covers both "rewrites rows" and
# "ADD CONSTRAINT validates existing rows". snapshot-prod-db.sh exists for
# the first kind ("runs cleanly but against the wrong rows" — see its
# header). For a migration that adds constraints and touches no row, a full
# prod dump protects nothing, and requiring one before every such migration
# trains people to treat the gate as a formality.
#
# Shared by deploy-prod.yml (blocking, against prod's real pending list) and
# quality.yml (warning, against a PR's added files) so the two can never
# disagree about what counts.
#
# USAGE: scripts/check-snapshot-claim.sh <migration-file>
# ==============================================================================

set -euo pipefail

FILE="${1:-}"

if [[ -z "${FILE}" || ! -f "${FILE}" ]]; then
  echo "Usage: $0 <migration-file>" >&2
  exit 2
fi

# --- 1. A referenced snapshot filename always satisfies the gate. ------------
#
# {4,14} covers both migration naming schemes: legacy 00NN numbers
# (0001-0058) and the YYYYMMDDHHMMSS timestamps used from 0059 onward (see
# .claude/CLAUDE.md "Migration naming"). snapshot-prod-db.sh passes the
# version prefix through verbatim into the filename.
if grep -qE '^--[[:space:]]*Data:.*[0-9]{4,14}_pre-migration_[0-9TZ:-]+\.tar\.gz' "${FILE}"; then
  echo "OK   ${FILE} — snapshot filename present"
  exit 0
fi

# --- 2. Otherwise: is a constraint-only exemption being claimed? -------------
if ! grep -qiE '^--[[:space:]]*Data:.*no snapshot required \(constraint-only\)' "${FILE}"; then
  echo "FAIL ${FILE} — destructive migration with no snapshot filename in its Data: line"
  exit 1
fi

# --- 3. The claim is made; verify it against the real SQL. ------------------
#
# Strip, in order: $$-quoted function bodies, block comments, line comments.
# Function bodies are excluded because a DML statement there runs only when
# the function is later CALLED, which is not this migration writing rows —
# the same distinction recorded for migration reversibility ("DML in a
# function body is not a data migration"). A migration whose body DML
# matters is one that also invokes it, and the invocation is a bare
# statement this does catch.
#
# The stripping AND the matching both happen in python, over the whole file
# as one string. They used to be split — python stripped, `grep -E` matched —
# but grep is line-oriented, so a statement broken across a newline
# (`UPDATE\n  officials SET ...`) slipped past a pattern that caught the
# identical single-line statement. Reformatting is not a reason to skip a
# snapshot, so the patterns below use `\s+` (which spans newlines) and the
# exit status comes straight from python.
set +e
offenders=$(python3 - "${FILE}" <<'PY'
import re, sys

sql = open(sys.argv[1], encoding="utf-8").read()

# $$-quoted bodies, including named tags like $func$ ... $func$.
sql = re.sub(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$.*?\$\1?\$", " ", sql, flags=re.S)
sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
sql = re.sub(r"--[^\n]*", " ", sql)

# Word-boundary matches so a column named "updated_at" or a constraint named
# "..._deleted_fkey" cannot trip this.
pattern = re.compile(
    r'(?<![A-Za-z0-9_])('
    r'INSERT\s+INTO'
    r'|UPDATE\s+[A-Za-z_"]'
    r'|DELETE\s+FROM'
    r'|TRUNCATE'
    r'|DROP\s+COLUMN'
    r')',
    re.I,
)

# Collapse each hit's internal whitespace so a wrapped statement prints as
# one readable line.
hits = [re.sub(r"\s+", " ", m.group(0)) for m in pattern.finditer(sql)]
for hit in hits[:10]:
    print(hit)

sys.exit(1 if hits else 0)
PY
)
found=$?
set -e

if [[ ${found} -ne 0 ]]; then
  echo "FAIL ${FILE} — claims 'no snapshot required (constraint-only)' but its SQL writes rows or drops a column"
  echo "     offending statements:"
  echo "${offenders}" | sed 's/^/       /'
  exit 1
fi

echo "OK   ${FILE} — constraint-only exemption, verified: no row-writing SQL"
exit 0
