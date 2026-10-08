import { NextResponse } from 'next/server';
import { destroySession } from '@/lib/session';

export const runtime = 'nodejs';

/** POST /api/auth/logout -> destroy the server-side session. */
export async function POST() {
  await destroySession();
  return NextResponse.json({ success: true });
}