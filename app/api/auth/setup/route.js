import bcrypt from 'bcryptjs';
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deriveVaultKey, generateSalt, packSessionCookie } from '@/lib/crypto';
import { SESSION_COOKIE, SESSION_MAX_AGE } from '@/lib/session';

// POST /api/auth/setup -> create the master password. Only works once;
// vault_config is a singleton row (id = 1).
export async function POST(request) {
  const { password } = await request.json();

  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Master password must be at least 8 characters' }, { status: 400 });
  }

  const { data: existing } = await supabase.from('vault_config').select('id').eq('id', 1).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'Vault is already set up' }, { status: 409 });
  }

  // HASH the master password for future logins (one-way).
  const passwordHash = await bcrypt.hash(password, 12);

  // Generate the salt used to DERIVE the encryption key from the
  // master password. The salt is stored; the key and password are not.
  const salt = generateSalt();

  const { error } = await supabase.from('vault_config').insert({ id: 1, password_hash: passwordHash, salt });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const vaultKey = deriveVaultKey(password, salt);
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
