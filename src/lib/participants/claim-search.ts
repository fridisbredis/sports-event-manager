// N39 (CLAIM-01): the client half of the claim list. Kept apart from
// claim-list.ts, which runs with the service role and must never reach the
// browser bundle.

export interface ClaimListRow {
  id: string
  bib: string | null
  name: string | null
  /** L11: claimed rows stay in the list, marked Claimed with "This is me". */
  claimed: boolean
}

// L10: search on bib or name. A bib matches from its start ("10" finds 101
// and 102, not 210); a name matches any word's start, so "berg" finds
// "Oskar Berg" and "Anna Bergqvist" but not "Ekberg".
export function matchesClaimSearch(row: ClaimListRow, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('sv')
  if (!q) return true
  if (row.bib?.toLocaleLowerCase('sv').startsWith(q)) return true
  const name = row.name?.toLocaleLowerCase('sv') ?? ''
  if (name.startsWith(q)) return true
  return name.split(/[\s-]+/).some((word) => word.startsWith(q))
}
