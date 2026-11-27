import { describe, it, expect } from 'vitest'

import { feedbackImagePath, pickFeedbackRole } from './feedback'

describe('pickFeedbackRole', () => {
  it('records an admin writing from the admin surface as tenant_admin', () => {
    expect(pickFeedbackRole('admin', ['tenant_admin'])).toBe('tenant_admin')
  })

  it('refuses the admin surface to someone without a tenant_admin row', () => {
    expect(pickFeedbackRole('admin', ['official'])).toBeNull()
    expect(pickFeedbackRole('admin', ['participant'])).toBeNull()
  })

  it('prefers the official role on the official surface when both are held', () => {
    expect(pickFeedbackRole('official', ['tenant_admin', 'official'])).toBe('official')
  })

  it('records an admin with no official row on the official surface as tenant_admin', () => {
    expect(pickFeedbackRole('official', ['tenant_admin'])).toBe('tenant_admin')
  })

  it('refuses the official surface to a participant', () => {
    expect(pickFeedbackRole('official', ['participant'])).toBeNull()
  })

  it('admits only participants on the participant surface', () => {
    expect(pickFeedbackRole('participant', ['participant'])).toBe('participant')
    expect(pickFeedbackRole('participant', ['tenant_admin'])).toBeNull()
  })

  it('refuses everything without a role in the tenant', () => {
    expect(pickFeedbackRole('admin', [])).toBeNull()
    expect(pickFeedbackRole('official', [])).toBeNull()
    expect(pickFeedbackRole('participant', [])).toBeNull()
  })
})

describe('feedbackImagePath', () => {
  it('builds tenant/user/feedback/image.ext with an extension from the type', () => {
    expect(feedbackImagePath('t', 'u', 'f', 'image/png')).toBe('t/u/f/image.png')
    expect(feedbackImagePath('t', 'u', 'f', 'image/webp')).toBe('t/u/f/image.webp')
    expect(feedbackImagePath('t', 'u', 'f', 'image/jpeg')).toBe('t/u/f/image.jpg')
  })
})
