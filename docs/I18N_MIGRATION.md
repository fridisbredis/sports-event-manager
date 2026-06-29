# i18next Migration Guide

This guide explains how to migrate hardcoded strings to i18next translation keys.

---

## Quick Start

### 1. Client Components (with `'use client'`)

Use the `useTranslation` hook:

```tsx
'use client'

import { useTranslation } from '@/lib/i18n/client'

export function MyComponent() {
  const { t } = useTranslation() // defaults to 'common' namespace
  // or: const { t } = useTranslation('admin') // to use 'admin' namespace

  return <button>{t('actions.save')}</button>
}
```

### 2. Server Components (default RSC)

Use the `getServerTranslation` helper:

```tsx
import { getServerTranslation } from '@/lib/i18n/server'

export default async function MyPage() {
  const t = await getServerTranslation('en') // specify language
  // or: const t = await getServerTranslation('en', 'admin') // with namespace

  return <h1>{t('dashboard.title')}</h1>
}
```

### 3. API Routes

Use the `getServerTranslation` helper:

```tsx
import { getServerTranslation } from '@/lib/i18n/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const t = await getServerTranslation('en')

  const errorMessage = t('errors.notAuthorized')
  return NextResponse.json({ error: errorMessage }, { status: 403 })
}
```

---

## Adding New Translation Keys

### 1. Add to JSON file

In `public/locales/en/admin.json`:

```json
{
  "dashboard": {
    "title": "Event Dashboard",
    "newFeature": "My new feature text"
  }
}
```

### 2. Use in component

```tsx
import { useTranslation } from '@/lib/i18n/client'

export function Feature() {
  const { t } = useTranslation('admin')
  return <p>{t('dashboard.newFeature')}</p>
}
```

---

## Namespaces

Choose the namespace based on the screen/feature:

- **`common`**: App-wide strings (app name, generic actions, errors)
- **`auth`**: Sign-in, OTP, invitation confirmation (AUTH-01, AUTH-02)
- **`admin`**: Tenant admin screens (EVT-01/02, WS-01/02, OFF-01, SCHED-01, COMM-01, ACCT-01)
- **`official`**: Official screens (HOME-01, INFO-01, MYSCH-01, ANN-01, ACCT-01 variant)

---

## Variable Interpolation

For strings with dynamic values, use `{{variable}}` syntax:

**JSON:**
```json
{
  "inviteSent": "Invite sent to {{name}}"
}
```

**Component:**
```tsx
const { t } = useTranslation('admin')
t('officials.inviteSent', { name: official.name })
```

---

## Adding a New Language

1. Create folder: `public/locales/sv/`
2. Copy all JSON files and translate
3. Update `src/lib/i18n/config.ts` → `locales` array to include `'sv'`
4. Update `src/components/i18n-provider.tsx` → import the new language files
5. Call `i18next.changeLanguage('sv')` to switch

Example for Swedish:
```tsx
// In a client component
import { useTranslation } from '@/lib/i18n/client'

export function LanguageSwitcher() {
  const { i18n } = useTranslation()

  return (
    <button onClick={() => i18n.changeLanguage('sv')}>
      Svenska
    </button>
  )
}
```

---

## Common Patterns

### Conditional rendering with translations

```tsx
const { t } = useTranslation('admin')

return (
  <>
    <h1>{t('dashboard.title')}</h1>
    {isPublished && <span>{t('dashboard.published')}</span>}
    {!isPublished && <span>{t('dashboard.draft')}</span>}
  </>
)
```

### Error messages from API

```tsx
// In API route
const t = await getServerTranslation('en')
return NextResponse.json({ error: t('errors.notAuthorized') })

// In client component
const response = await fetch('/api/endpoint')
const { error } = await response.json()
// error is already translated (if sent from server)
```

### Default values (fallback)

If a key is missing, i18next will return the key name itself. Always check the browser console or the translations JSON if text doesn't appear correctly.

---

## Existing Hardcoded Strings to Migrate

These files have hardcoded strings that need migration:

- `src/app/page.tsx` — "Ingen behörighet", "Ditt konto är inte kopplat..."
- `src/app/(auth)/login/page.tsx` — all form labels and buttons
- `src/app/(tenant)/[tenantSlug]/dashboard/page.tsx` — status labels, titles, counts
- `src/app/(tenant)/[tenantSlug]/event/_components/event-config-form.tsx` — form labels, placeholders, error messages
- All other components as they're built

---

## File Structure

```
src/
  lib/i18n/
    config.ts          — i18next configuration
    client.ts          — useTranslation hook for client components
    server.ts          — getServerTranslation for server components
  components/
    i18n-provider.tsx  — I18nProvider wrapper (client)

public/
  locales/
    en/
      common.json      — app-wide strings
      auth.json        — AUTH screens
      admin.json       — admin screens (EVT, WS, OFF, SCHED, COMM, ACCT admin)
      official.json    — official screens (HOME, INFO, MYSCH, ANN, ACCT official)
    sv/                — (future) Swedish translations
      common.json
      auth.json
      admin.json
      official.json
```

---

## Testing

### 1. Verify translations load

Open DevTools Console and search for any warnings about missing translation keys.

### 2. Switch language (when implemented)

```tsx
// In browser console
import('i18next').then(m => m.default.changeLanguage('sv'))
```

### 3. Check the JSON is valid

Run:
```bash
npm run build
```

If translation JSON files have syntax errors, the build will fail.

---

## Troubleshooting

### Text shows as `common.key.name` instead of translated string

- Check that the key exists in the correct JSON file
- Verify the namespace is correct in `useTranslation('namespace')` or `getServerTranslation('en', 'namespace')`
- Restart dev server: `npm run dev`

### Build fails with `Cannot find module`

- Ensure translation JSON files exist in `public/locales/{language}/{namespace}.json`
- Check for typos in file names

### Changes to JSON don't appear after save

- Restart dev server: `npm run dev`
- Clear browser cache

---

## References

- [i18next docs](https://www.i18next.com/)
- [react-i18next docs](https://react.i18next.com/)
- [i18next-resources-to-backend](https://github.com/i18next/i18next-resources-to-backend)
