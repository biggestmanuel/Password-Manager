import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { getVaultKeyFromCookies } from '@/lib/session';

// GET /api/auth/status -> { vaultExists, loggedIn }
export async function GET() {
  const { data: config } = await supabase.from('vault_config').select('id').eq('id', 1).maybeSingle();
  const vaultKey = getVaultKeyFromCookies(cookies());

  return NextResponse.json({
    vaultExists: !!config,
    loggedIn: !!vaultKey,
  });
}
