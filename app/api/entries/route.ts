import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { requireSession } from '@/lib/session';
import { createEntrySchema, jsonError, parseBody } from '@/lib/api';
import type { StoredEntry, SyncResponse } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Columns we ever return. Kept explicit so a future column can never be
 *  leaked by accident via a bare `select *`. */
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
 * GET /api/entries?since=<iso> -> sync.
 *
 * Returns ciphertext. Supports a delta query so a device only downloads
 * what changed rather than the whole vault on every poll. Tombstones
 * (deleted_at set) are included: without them a device that was offline
 * during a delete would keep showing the deleted entry forever.
 */
export async function GET(request: Request) {
  const session = await requireSession();
  if (!session) return jsonError('Not authenticated', 401);

  const since = new URL(request.url).searchParams.get('since');

  let query = getSupabase().from('vault_entries').select(COLUMNS);
  if (since) {
    const parsed = Date.parse(since);
    if (Number.isNaN(parsed)) return jsonError('Invalid since parameter', 400);
    query = query.gt('updated_at', new Date(parsed).toISOString());
  }

  const { data, error } = await query.order('updated_at', { ascending: true });
  if (error) return jsonError(error.message, 500);

  const response: SyncResponse = {
    entries: (data as EntryRow[]).map(toStored),
    syncedAt: new Date().toISOString(),
  };

  return NextResponse.json(response);
}

/**
 * POST /api/entries -> create an entry.
 *
 * The id is generated client-side so it can be bound into the ciphertext as
 * additional authenticated data. A server-chosen id would not be known
 * until after encryption, which would forfeit that binding.
 */
export async function POST(request: Request) {
  const session = await requireSession();
  if (!session) return jsonError('Not authenticated', 401);

  const parsed = await parseBody(request, createEntrySchema);
  if (!parsed.ok) return parsed.response;
  const { id, payload, iv, authTag } = parsed.data;

  const supabase = getSupabase();

  const { error } = await supabase.from('vault_entries').insert({
    id,
    payload,
    iv,
    auth_tag: authTag,
  });

  if (error) {
    // Most likely a duplicate id, i.e. the same entry synced twice.
    if (error.code === '23505') return jsonError('Entry already exists', 409);
    return jsonError(error.message, 500);
  }

  return NextResponse.json({ id }, { status: 201 });
}