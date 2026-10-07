import { describe, it, expect } from 'vitest'
import { createInstance } from 'i18next'
import enAdmin from '../../../../../../../public/locales/en/admin.json'
import svAdmin from '../../../../../../../public/locales/sv/admin.json'

// `scheduling.slotModalStatus` is the only nested object under `scheduling` —
// every other key there is a flat string. A nested lookup depends on i18next's
// default `keySeparator: '.'`, which the app's config never sets explicitly,
// so this pins that the three chips resolve rather than rendering their own
// key path at an admin. It also catches the likelier failure: one language
// gaining a status the other does not.
describe('slot modal status chips', () => {
  const statuses = ['available', 'timeOff', 'assigned'] as const

  it.each(['en', 'sv'])('resolves every status in %s', async (lng) => {
    const i18n = createInstance()
    await i18n.init({
      lng,
      resources: { en: { admin: enAdmin }, sv: { admin: svAdmin } },
      ns: ['admin'],
      defaultNS: 'admin',
    })

    for (const status of statuses) {
      const key = `scheduling.slotModalStatus.${status}`
      const text = i18n.t(key)
      expect(text, `${lng}: ${key} did not resolve`).not.toBe(key)
      expect(text.length).toBeGreaterThan(0)
    }
  })

  it('defines the same statuses in both languages', () => {
    const en = Object.keys(enAdmin.scheduling.slotModalStatus).sort()
    const sv = Object.keys(svAdmin.scheduling.slotModalStatus).sort()
    expect(sv).toEqual(en)
    expect(en).toEqual([...statuses].sort())
  })
})
