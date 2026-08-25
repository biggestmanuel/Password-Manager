import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deriveVaultKey, packSessionCookie } from '@/lib/crypto';
import { SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session';

// POST /api/auth/login -> verify master password, start a session
export async function POST(request) {
  const { password } = await request.json();
  if (!password) {
    return NextResponse.json({ error: 'Password is required' }, { status: 400 });
  }

  const { data: config, error } = await supabase
    .from('vault_config')
    .select('password_hash, salt')
    .eq('id', 1)
    .maybeSingle();

  if (error || !config) {
    return NextResponse.json({ error: 'Vault has not been set up yet' }, { status: 404 });
  }

  // Compare against the HASH — this never reveals or reconstructs the
  // original master password, it just proves the input matches.
  const valid = await bcrypt.compare(password, config.password_hash);
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect master password' }, { status: 401 });
  }

  // Re-derive the same vault key deterministically from the password
  // + stored salt (same inputs -> same key, every time).
  const vaultKey = deriveVaultKey(password, config.salt);
  const sessionValue = packSessionCookie(vaultKey);

  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, sessionValue, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  return res;
}
