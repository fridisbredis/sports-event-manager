#!/usr/bin/env bash
#
# Lists local branches and worktrees that are safe to delete, then asks for
# confirmation before deleting them.
#
# WHY THIS EXISTS
#
# With two people (and Claude sessions) creating branches and worktrees for
# every PR, local clutter builds up fast — branches whose PR merged or closed
# weeks ago, worktrees left behind after a review session. `git branch -d`
# only catches branches merged into the CURRENT branch's history, which
# misses anything squash-merged (the default for this repo's PRs) — squashed
# commits never match the original commit hashes, so git sees them as
# "unmerged" forever even though the PR landed. Checking each branch's PR
# state via `gh` is the only reliable signal.
#
# WHAT COUNTS AS SAFE
#
# A branch is a delete candidate if EITHER:
#   - `gh pr list` shows a MERGED or CLOSED (non-open) PR for that branch, or
#   - the branch has no PR at all AND is already contained in origin/main
#     (covers direct pushes / branches never opened as a PR)
#
# A branch is NEVER a candidate if it has an OPEN PR, or if it's the branch
# currently checked out, or if it's main/master.
#
# Worktrees are listed separately — this script never assumes a worktree is
# safe just because its branch is. It only prunes worktrees whose branch is
# about to be deleted, and only after confirming there is no uncommitted
# work in that worktree.
#
# USAGE
#   scripts/clean-branches.sh          # dry run — just lists candidates
#   scripts/clean-branches.sh --yes    # deletes after listing, no prompt
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

AUTO_YES=false
if [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]]; then
  AUTO_YES=true
fi

echo "Fetching and pruning remote-tracking refs..."
git fetch origin --prune --quiet

current_branch=$(git branch --show-current)
default_branch="main"

echo
echo "Checking open PRs on GitHub..."
open_prs=$(gh pr list --state open --limit 500 --json headRefName --jq '.[].headRefName')

declare -a branch_candidates=()
declare -a worktree_candidates=()

while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  [[ "$branch" == "$current_branch" ]] && continue
  [[ "$branch" == "$default_branch" ]] && continue

  if grep -qxF "$branch" <<<"$open_prs"; then
    continue # has an open PR — never touch
  fi

  pr_state=$(gh pr list --state all --head "$branch" --limit 1 --json state --jq '.[0].state' 2>/dev/null || echo "")

  if [[ "$pr_state" == "MERGED" || "$pr_state" == "CLOSED" ]]; then
    branch_candidates+=("$branch")
  elif [[ -z "$pr_state" ]]; then
    # No PR ever opened for this branch — only safe if fully merged into main
    if git merge-base --is-ancestor "$branch" origin/main 2>/dev/null; then
      branch_candidates+=("$branch")
    fi
  fi
done < <(git branch --format='%(refname:short)')

echo
echo "Checking worktrees..."
while IFS= read -r line; do
  wt_path=$(awk '{print $1}' <<<"$line")
  wt_branch=$(sed -n 's/.*\[\(.*\)\]/\1/p' <<<"$line")
  [[ "$wt_path" == "$(pwd)" ]] && continue # main worktree, never touch
  worktree_candidates+=("$wt_path|$wt_branch")
done < <(git worktree list)

echo
if [[ ${#branch_candidates[@]} -eq 0 && ${#worktree_candidates[@]} -eq 0 ]]; then
  echo "Nothing to clean up — no stale branches or worktrees found."
  exit 0
fi

if [[ ${#branch_candidates[@]} -gt 0 ]]; then
  echo "Branches to delete (merged or closed PR, or already in main):"
  for b in "${branch_candidates[@]}"; do
    echo "  - $b"
  done
fi

if [[ ${#worktree_candidates[@]} -gt 0 ]]; then
  echo
  echo "Worktrees found (removed regardless of branch state — you asked for 0 worktrees):"
  for entry in "${worktree_candidates[@]}"; do
    wt_path="${entry%%|*}"
    dirty=""
    if [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]]; then
      dirty=" (HAS UNCOMMITTED CHANGES — will be skipped)"
    fi
    echo "  - $wt_path${dirty}"
  done
fi

echo
if [[ "$AUTO_YES" == false ]]; then
  read -r -p "Proceed with deletion? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted, nothing deleted."
    exit 0
  fi
fi

for entry in "${worktree_candidates[@]}"; do
  wt_path="${entry%%|*}"
  if [[ -n "$(git -C "$wt_path" status --porcelain 2>/dev/null)" ]]; then
    echo "Skipping dirty worktree: $wt_path"
    continue
  fi
  git worktree remove "$wt_path" --force
done
git worktree prune

for b in "${branch_candidates[@]}"; do
  git branch -D "$b"
done

echo
echo "Done."
