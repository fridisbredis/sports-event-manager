import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createSupabaseServerClient } from '@/lib/supabase/server'

// POST, not GET: signing out is a side effect, and a GET endpoint can be
// triggered by anything that merely follows a URL — a next/link prefetch, a
// link preview, a crawler.
export async function POST() {
  try {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.signOut()
    if (error) console.error('signOut error:', error)

    // Delete every sb-* cookie unconditionally, regardless of whether the
    // provider call above succeeded — this is the whole point of routing
    // logout through the server: only the server owns the cookie jar and can
    // clear it even when the remote revoke fails. The residual trade-off is
    // that on a failed revoke the refresh token stays valid until it expires,
    // which is far less dangerous than leaving a live local session on a
    // shared device.
    const cookieStore = await cookies()
    for (const cookie of cookieStore.getAll()) {
      if (cookie.name.startsWith('sb-')) cookieStore.delete(cookie.name)
    }

    return new NextResponse(null, { status: 204 })
  } catch {
    return new NextResponse(null, { status: 500 })
  }
}
