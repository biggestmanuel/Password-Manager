import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabase } from '@/lib/supabase';
import { encrypt } from '@/lib/crypto';
import { getVaultKeyFromCookies } from '@/lib/session';

// PATCH /api/entries/:id -> update any subset of fields. If password is
// included, it's re-encrypted with a fresh IV (never reuse an IV).
export async function PATCH(request, { params }) {
  const vaultKey = getVaultKeyFromCookies(cookies());
  if (!vaultKey) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const { id } = params;
  const body = await request.json();
  const updates = {};

  if ('site' in body) updates.site = body.site.trim();
  if ('username' in body) updates.username = body.username?.trim() || null;
  if ('notes' in body) updates.notes = body.notes?.trim() || null;
  if ('password' in body && body.password) {
    const { ciphertext, iv, authTag } = encrypt(body.password, vaultKey);
    updates.encrypted_password = ciphertext;
    updates.iv = iv;
    updates.auth_tag = authTag;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const { data, error } = await supabase.from('vault_entries').update(updates).eq('id', id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    id: data.id,
    site: data.site,
    username: data.username,
    password: body.password || undefined,
    notes: data.notes,
  });
}

// DELETE /api/entries/:id
export async function DELETE(request, { params }) {
  const vaultKey = getVaultKeyFromCookies(cookies());
  if (!vaultKey) return NextResponse.json({ error: 'Not logged in' }, { status: 401 });

  const { id } = params;
  const { error } = await supabase.from('vault_entries').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
