import { NextResponse } from 'next/server'

// Liveness probe — deliberately makes NO database call.
//
// Azure Container Apps restarts a replica when its probe fails; it does
// not just take the replica out of rotation. If this endpoint queried
// Supabase the way /api/health does, a transient database outage would
// fail the probe on every replica at once and turn a DB blip into a full
// restart-loop outage. The database health signal is reported separately
// via a 5xx-rate metric alert, not through this probe.
//
// Do NOT add a database check here. If a DB-aware check is needed, use
// /api/health instead.
//
// Marked force-dynamic so every probe hit re-executes the handler instead
// of Next.js serving a cached response from build time — a liveness check
// must reflect the process right now.
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ status: 'ok' })
}
