import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { requireSession } from '@/lib/session';
import { jsonError, parseBody, updateEntrySchema } from '@/lib/api';
import type { StoredEntry } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Explicit column list, so no future column can leak via a bare `select *`. */
const COLUMNS = 'id, payload, iv, auth_tag, revision, deleted_at, created_at, updated_at';

type EntryRow = {
  id: string;
  payload: string;
  iv: string;
  auth_tag: string;
  revision: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

function toStored(row: EntryRow): StoredEntry {
  return {
    id: row.id,
    payload: row.payload,
    iv: row.iv,
    authTag: row.auth_tag,
    revision: row.revision,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * PATCH /api/entries/:id -> replace the ciphertext.
 *
 * The client decrypts, edits in plaintext, and re-encrypts the whole
 * payload, so this route never needs to understand the entry's contents.
 * That is deliberate: no plaintext-handling code on the server means no
 * bug on the server can leak plaintext.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return jsonError('Not authenticated', 401);

  const parsed = await parseBody(request, updateEntrySchema);
  if (!parsed.ok) return parsed.response;
  const { payload, iv, authTag, baseRevision } = parsed.data;

  const { id } = await params;
  const supabase = getSupabase();

  const { data: current, error: readError } = await supabase
    .from('vault_entries')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (readError) return jsonError(readError.message, 500);
  if (!current) return jsonError('Entry not found', 404);

  const existing = current as EntryRow;

  if (existing.deleted_at) {
    return jsonError('Entry has been deleted on another device', 410);
  }

  // Optimistic concurrency: refuse to overwrite a newer revision, and hand
  // back the current state so the client can merge.
  if (existing.revision > baseRevision) {
    return NextResponse.json(
      { error: 'This entry was changed on another device', conflict: toStored(existing) },
      { status: 409 },
    );
  }

  const { data, error } = await supabase
    .from('vault_entries')
    .update({
      payload,
      iv,
      auth_tag: authTag,
      revision: existing.revision + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select(COLUMNS)
    .single();

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ entry: toStored(data as EntryRow) });
}

/**
 * DELETE /api/entries/:id -> soft delete (tombstone).
 *
 * The row is kept with deleted_at set rather than removed, because a hard
 * delete is invisible to a device that was offline at the time: it would
 * keep showing the entry and, on its next sync, there would be no
 * contradiction to detect, so the deletion would be silently undone.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return jsonError('Not authenticated', 401);

  const { id } = await params;
  const supabase = getSupabase();

  const { error } = await supabase
    .from('vault_entries')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ success: true });
}