Create a new React component named $ARGUMENTS.

Where to place it:
- Shared/reusable across the app → `src/components/$ARGUMENTS.tsx`
- Used only within one route → co-locate in that route's `_components/` folder
- Small UI primitive (button, badge, input) → `src/components/ui/$ARGUMENTS.tsx`

Conventions:
- Default export, PascalCase name
- Props interface named `${ComponentName}Props`
- TypeScript — no `any`
- Tailwind utility classes for styling — no CSS modules
- No comments unless the WHY is non-obvious
- Add 'use client' only if the component uses state, effects, or event handlers — default to Server Component

i18n:
- All visible strings go through t() — import useTranslation from src/lib/i18n/client.ts
- Namespace: the relevant section in public/locales/en/ (e.g. 'admin', 'official')

Examples of existing components for reference:
- src/components/unsaved-changes-dialog.tsx — modal dialog
- src/components/confirm-dialog.tsx — confirmation dialog
- src/components/ui/ — small UI primitives

Tests (Vitest):
- If the component has logic beyond rendering static JSX (conditionals, derived state, event handling), add `$ARGUMENTS.test.tsx` next to it using @testing-library/react
- Skip tests for pure presentational components with no branching logic
