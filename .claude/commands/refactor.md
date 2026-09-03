Context:
@context.md
@skills/supabase-core.md
@skills/ui-system.md

Refactor this code:
{{selection}}

Goals:

- Improve readability
- Reduce complexity
- Extract sub-components only when a piece is reused or clearly self-contained — not just to split lines
- Exception: if the file exceeds ~400 lines, extract self-contained sections into their own files even if only used once — file size alone justifies the split at that point

Constraints:

- No behavior changes
- Minimal edits — don't touch what doesn't need changing
- Don't add comments explaining what the code does
- Don't introduce new abstractions that are only used once
- Keep all UI strings going through t() — don't hardcode

Tests (Vitest):

- If a test file already exists for the code being refactored, run `npm test` before and after to confirm behavior is unchanged
- If no test file exists and the code has non-trivial logic, add one first (co-located `<filename>.test.ts`, following `src/lib/scheduling/grid-logic.test.ts` as the convention) so the refactor is verifiably safe

Next.js / React rules:

- Keep Server Components as Server Components — don't add 'use client' unnecessarily
- State and event handlers belong in Client Components
- Server Actions stay in separate files with 'use server'

Output:

- Refactored code only, no explanation
