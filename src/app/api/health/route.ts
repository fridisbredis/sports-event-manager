import { NextResponse } from 'next/server'
import { createSupabaseServiceClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'

// Liveness + readiness probe. No auth required — reports process and
// database health only, no tenant or user data.
export async function GET() {
  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('tenants').select('id').limit(1)

  if (error) {
    logger.error('Health check: database query failed', error)
    return NextResponse.json({ status: 'error', database: 'unreachable' }, { status: 503 })
  }

  return NextResponse.json({ status: 'ok', database: 'reachable' })
}
