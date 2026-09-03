import { describe, it, expect, afterEach } from 'vitest'
import { currentSupabaseProjectRef } from './constants'

describe('currentSupabaseProjectRef', () => {
  const ENV = process.env

  afterEach(() => {
    process.env = ENV
  })

  it('returns the project ref from a cloud Supabase URL', () => {
    process.env = { ...ENV, NEXT_PUBLIC_SUPABASE_URL: 'https://lhflutwvwvzawzbcuwup.supabase.co' }

    expect(currentSupabaseProjectRef()).toBe('lhflutwvwvzawzbcuwup')
  })

  it('labels the local Docker stack instead of returning "127" from its IP', () => {
    process.env = { ...ENV, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }

    expect(currentSupabaseProjectRef()).toBe('local (Docker)')
  })
})
