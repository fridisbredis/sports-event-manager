import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  async function signOut() {
    'use server'
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
    redirect('/login')
  }

  return (
    <main className="max-w-md mx-auto mt-20 p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">You're signed in 🎉</h1>
        <p className="mt-2 text-sm text-gray-600">
          Phase 1 of the setup is working: Next.js + Supabase Auth + Twilio
          delivered an SMS and verified the OTP.
        </p>
      </div>

      <div className="rounded border border-gray-200 p-4 space-y-2 text-sm">
        <div>
          <span className="text-gray-500">Phone:</span>{' '}
          <span className="font-mono">{user.phone}</span>
        </div>
        <div>
          <span className="text-gray-500">User ID:</span>{' '}
          <span className="font-mono text-xs">{user.id}</span>
        </div>
        <div>
          <span className="text-gray-500">Signed in at:</span>{' '}
          <span>{new Date(user.last_sign_in_at!).toLocaleString('sv-SE')}</span>
        </div>
      </div>

      <form action={signOut}>
        <button
          type="submit"
          className="w-full bg-black text-white rounded py-2 hover:bg-gray-800"
        >
          Sign out
        </button>
      </form>

      <p className="text-xs text-gray-500">
        TODO: post-login routing based on user role (system_admin → /admin,
        tenant_admin → /[tenantSlug]/dashboard, etc.)
      </p>
    </main>
  )
}
