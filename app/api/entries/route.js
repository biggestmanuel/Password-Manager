import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { encrypt, decrypt } from '@/lib/crypto';
import { getVaultKeyFromCookies } from '@/lib/session';

// GET /api/entries -> list all entries, passwords DECRYPTED for display.
// Decryption only happens here, in memory, per-request — never stored
// decrypted anywhere.
export async function GET() {
  const vaultKey = getVaultKeyFromCookies(cookies());
  if (!vaultKey) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const { data, error } = await supabase.from('vault_entries').select('*').order('site', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = data.map((row) => ({
    id: row.id,
    site: row.site,
    username: row.username,
    password: decrypt(
      { ciphertext: row.encrypted_password, iv: row.iv, authTag: row.auth_tag },
      vaultKey
    ),
    notes: row.notes,
  }));

  return NextResponse.json(entries);
}

// POST /api/entries -> create an entry, password ENCRYPTED before storage
export async function POST(request) {
  const vaultKey = getVaultKeyFromCookies(cookies());
  if (!vaultKey) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const body = await request.json();
  if (!body.site || !body.password) {
    return NextResponse.json({ error: 'Site and password are required' }, { status: 400 });
  }

  const { ciphertext, iv, authTag } = encrypt(body.password, vaultKey);

  const { data, error } = await supabase
    .from('vault_entries')
    .insert({
      site: body.site.trim(),
      username: body.username?.trim() || null,
      encrypted_password: ciphertext,
      iv,
      auth_tag: authTag,
      notes: body.notes?.trim() || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(
    { id: data.id, site: data.site, username: data.username, password: body.password, notes: data.notes },
    { status: 201 }
  );
}
