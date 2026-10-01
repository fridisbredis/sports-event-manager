import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// getUserLanguage() resolves the signed-in user's stored UI language, and the
// translation helpers in src/lib/actions (translateActionError,
// translateDbError, translateStorageError) call it on every error path. That
// makes it an incidental dependency of a large number of tests that have
// nothing to do with i18n: they mock '@/lib/auth/tenant' with only the exports
// they themselves use, so the getCurrentUser() call inside getUserLanguage()
// hits an undefined export and the test fails on a module it never named.
//
// Stubbed globally to the default locale so those tests keep asserting on the
// English strings they already expect. A test that actually cares about the
// stored language can still override this with its own vi.mock.
vi.mock('@/lib/i18n/user-language', () => ({
  getUserLanguage: vi.fn().mockResolvedValue('en'),
}))
