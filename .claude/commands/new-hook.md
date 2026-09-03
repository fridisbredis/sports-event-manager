Create a new custom React hook named $ARGUMENTS in `src/lib/hooks/`.

Conventions:

- Hook name must start with `use` (e.g. `useOfficialStatus`)
- One hook per file, focused on a single concern
- TypeScript — no `any`
- No comments unless the WHY is non-obvious
- Client-side only — hooks run in Client Components ('use client')
- If the hook needs data from Supabase, use the browser client: createSupabaseBrowserClient() from src/lib/supabase/client.ts

Place the file at `src/lib/hooks/$ARGUMENTS.ts`.

Example of an existing hook for reference: src/lib/hooks/use-unsaved-changes.ts

Tests (Vitest):

- Add `src/lib/hooks/$ARGUMENTS.test.ts` using `renderHook` from @testing-library/react
- Test the hook's behavior (state transitions, returned values under different inputs) — not implementation details
- Mock any Supabase client calls
