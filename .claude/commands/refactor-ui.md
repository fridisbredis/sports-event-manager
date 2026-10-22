Plan first (before anything else):

- Call EnterPlanMode as the very first action of this command, before reading
  files or running anything. Don't skip it because the task looks small, and
  don't ask whether to plan — just enter.
- If plan mode is already active, this is a no-op. Entering twice is harmless;
  not entering is the failure mode this guards against.
- Then explore, and present the plan for approval via ExitPlanMode. No edits,
  migrations or commands that change state until the plan is approved.

Refactor this code:
{{selection}}

Expectation:
{{description}}

Use:

- UI skill for layout

Tests (Vitest):

- If the component has logic beyond layout/styling (conditionals, calculations), run `npm test` after the refactor to confirm behavior is unchanged
- Pure visual/layout changes don't need new tests

Output:

- Streamlined design ie same sizes and paddings and margins as the rest of the app
- Clean React implementation
- No explanation unless necessary
- Show only relevant files
