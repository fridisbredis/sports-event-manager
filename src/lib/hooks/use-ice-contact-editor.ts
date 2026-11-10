'use client'

import { useRef, useState } from 'react'
import { useTranslation } from '@/lib/i18n/client'
import { useAutosave } from '@/lib/hooks/use-autosave'
import { formatPhoneForDisplay } from '@/lib/phone'
import { normalizeIceContact, type IceContact, type IceContactInput } from '@/lib/ice-contact'

function iceContactToInput(contact: IceContact | null): IceContactInput {
  return {
    phone: contact?.phone ? formatPhoneForDisplay(contact.phone) : '',
    name: contact?.name ?? '',
    relation: contact?.relation ?? '',
  }
}

function iceKey(input: IceContactInput): string | null {
  const normalized = normalizeIceContact(input)
  return normalized.ok ? JSON.stringify(normalized.contact) : null
}

// N37: the ICE contact is a separate, user-scoped write (/api/account/ice),
// not part of any tenant-scoped account PATCH — the same person has one ICE
// contact across every tenant. It saves when focus leaves one of its three
// fields rather than per keystroke: a half-typed phone number is not valid,
// and validating it while the user is still typing would flash an error at
// them for a number they have not finished.
//
// Shared by the official ACCT-01 and its participant variant (N43). Returns
// the autosave status rather than rendering one, so each form folds it into
// its own single save line.
export function useIceContactEditor(initial: IceContact | null, onSaveError: () => void) {
  const { t: tCommon } = useTranslation('common')

  const [value, setValue] = useState<IceContactInput>(() => iceContactToInput(initial))
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const valueRef = useRef(value)
  // What the server last accepted, normalized — so leaving a field without
  // having changed anything (or having changed it back) writes nothing.
  // Derived through the same normalization as a save, so key order and phone
  // shape match what onBlur compares against.
  const saved = useRef(iceKey(iceContactToInput(initial)))

  const save = useAutosave<string>({
    onSave: async (key) => {
      const res = await fetch('/api/account/ice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // The raw text, not the normalized phone: the route normalizes again
        // and a bare "4670…" without its '+' would read as a national number.
        body: JSON.stringify(valueRef.current),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        if (body?.code === 'invalid_phone') setPhoneError(tCommon('iceContact.invalidPhone'))
        throw new Error('Save failed')
      }
      saved.current = key
    },
    delay: 0,
    onError: onSaveError,
  })

  function onChange(next: IceContactInput) {
    if (next.phone !== valueRef.current.phone) setPhoneError(null)
    setValue(next)
    valueRef.current = next
  }

  function onBlur() {
    const key = iceKey(valueRef.current)
    if (key === null) {
      setPhoneError(tCommon('iceContact.invalidPhone'))
      return
    }
    if (key === saved.current) return
    save.queue(key)
  }

  return { value, phoneError, onChange, onBlur, status: save.status }
}
