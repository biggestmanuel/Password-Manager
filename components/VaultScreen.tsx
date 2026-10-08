'use client';

import { useMemo, useState } from 'react';
import { Alert, Button, Card, Input, cx } from './ui';
import { EntryForm } from './EntryForm';
import type { DecryptedEntry, VaultEntryPayload } from '@/lib/types';
import { formatSyncedAt, type VaultState } from '@/lib/use-vault';
import type { ApiError } from '@/lib/vault-client';

/**
 * Copy to clipboard.
 *
 * `navigator.clipboard` is unavailable on insecure origins (plain http on
 * a LAN address is the common case for a self-hosted vault), so fall back
 * to a selection + execCommand path rather than leaving the button dead.
 *
 * The clipboard is cleared on a timer. Leaving a password sitting on the
 * clipboard indefinitely is a real leak: it is readable by any page the
 * user visits next, and it often persists across a restart.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function EntryCard({
  entry,
  revealed,
  onToggleReveal,
  onCopy,
  onEdit,
  onDelete,
  copyState,
}: {
  entry: DecryptedEntry;
  revealed: boolean;
  onToggleReveal: () => void;
  onCopy: (field: 'password' | 'username', value: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  copyState: string | null;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="rounded-lg border border-gray-800 bg-gray-900 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{entry.site}</p>

          {entry.username ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-xs text-gray-400">{entry.username}</span>
              <button
                onClick={() => onCopy('username', entry.username)}
                className="shrink-0 text-[11px] text-gray-600 hover:text-gray-300"
                aria-label={`Copy username for ${entry.site}`}
              >
                copy
              </button>
            </div>
          ) : null}

          <div className="mt-1.5 flex items-center gap-2">
            <code className="select-all break-all font-mono text-xs text-gray-300">
              {revealed ? entry.password : '••••••••••••••'}
            </code>
            <button
              onClick={onToggleReveal}
              className="shrink-0 text-[11px] text-gray-500 hover:text-gray-200"
              aria-label={revealed ? `Hide password for ${entry.site}` : `Reveal password for ${entry.site}`}
            >
              {revealed ? 'Hide' : 'Reveal'}
            </button>
          </div>

          {entry.notes ? (
            <p className="mt-2 whitespace-pre-wrap break-words text-xs text-gray-500">{entry.notes}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Button
            variant="secondary"
            className="!px-2 !py-1 text-xs"
            onClick={() => onCopy('password', entry.password)}
            aria-label={`Copy password for ${entry.site}`}
          >
            Copy
          </Button>
          <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={onEdit}>
            Edit
          </Button>
          {confirming ? (
            <div className="flex items-center gap-1">
              <Button
                variant="danger"
                className="!px-2 !py-1 text-xs"
                onClick={() => {
                  setConfirming(false);
                  onDelete();
                }}
              >
                Confirm
              </Button>
              <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" className="!px-2 !py-1 text-xs" onClick={() => setConfirming(true)}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

export function VaultScreen({
  state,
  onSaveEntry,
  onDeleteEntry,
  onSync,
  onLock,
}: {
  state: VaultState;
  onSaveEntry: (entry: DecryptedEntry | null, data: VaultEntryPayload) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
  onSync: () => Promise<void>;
  onLock: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<DecryptedEntry | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<string | null>(null);

  // Search runs over decrypted data in memory. That is inherent to a
  // zero-knowledge design: the server cannot filter, because it cannot read.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return state.entries;
    return state.entries.filter(
      (entry) =>
        entry.site.toLowerCase().includes(needle) ||
        entry.username.toLowerCase().includes(needle),
    );
  }, [state.entries, query]);

  async function handleCopy(field: 'password' | 'username', value: string) {
    const ok = await copyToClipboard(value);
    if (!ok) {
      setNotice('Clipboard blocked by the browser. Select the text and copy manually.');
      return;
    }
    const label = field === 'password' ? 'Password' : 'Username';
    setNotice(`${label} copied. Clipboard clears in 30s.`);
    setCopyState(`${field}-${value}`);

    // Best-effort clear. Timers are suspended on a backgrounded tab, so
    // this is a mitigation rather than a guarantee.
    setTimeout(() => navigator.clipboard?.writeText('').catch(() => {}), 30_000);
    setTimeout(() => setCopyState(null), 2_000);
    setTimeout(() => setNotice(null), 4_000);
  }

  async function handleDelete(id: string) {
    await onDeleteEntry(id);
    setUndoId(id);
    setTimeout(() => setUndoId(null), 8_000);
  }

  const conflict = state.error?.includes('changed on another device');

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Vault</h1>
          <p className="text-xs text-gray-500">
            {state.entries.length} {state.entries.length === 1 ? 'entry' : 'entries'} · synced{' '}
            {formatSyncedAt(state.lastSyncedAt)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="!px-2.5 !py-1.5 text-xs"
            onClick={() => void onSync()}
            disabled={state.syncing}
          >
            {state.syncing ? 'Syncing…' : 'Sync'}
          </Button>
          <Button variant="ghost" className="!py-1.5 text-xs" onClick={() => void onLock()}>
            Lock
          </Button>
        </div>
      </header>

      {notice ? (
        <div className="mb-4">
          <Alert tone="info">{notice}</Alert>
        </div>
      ) : null}

      {state.error ? (
        <div className="mb-4">
          <Alert tone={conflict ? 'warning' : 'error'}>
            {state.error}
            {conflict ? ' Reload your entries to see the newer version before saving again.' : null}
          </Alert>
        </div>
      ) : null}

      {state.undecryptable > 0 ? (
        <div className="mb-4">
          <Alert tone="warning">
            {state.undecryptable} {state.undecryptable === 1 ? 'entry' : 'entries'} could not be
            decrypted and {state.undecryptable === 1 ? 'is' : 'are'} hidden. This can happen if the
            database was modified outside the app.
          </Alert>
        </div>
      ) : null}

      {editing ? (
        <div className="mb-6">
          <EntryForm
            editing={editing}
            onSave={async (data) => {
              await onSaveEntry(editing, data);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <div className="mb-6">
          <EntryForm editing={null} onSave={(data) => onSaveEntry(null, data)} />
        </div>
      )}

      {state.loading ? (
        <p className="text-sm text-gray-500">Decrypting…</p>
      ) : state.entries.length === 0 ? (
        <p className="text-sm text-gray-500">No entries yet. Add your first one above.</p>
      ) : (
        <>
          <div className="mb-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search site or username…"
              aria-label="Search vault"
              type="search"
            />
          </div>

          {filtered.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing matches “{query}”.</p>
          ) : (
            <ul className="space-y-2">
              {filtered.map((entry) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  revealed={revealedId === entry.id}
                  copyState={copyState}
                  onToggleReveal={() => setRevealedId(revealedId === entry.id ? null : entry.id)}
                  onCopy={(field, value) => void handleCopy(field, value)}
                  onEdit={() => {
                    setEditing(entry);
                    setRevealedId(null);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  onDelete={() => void handleDelete(entry.id)}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {undoId ? (
        <div className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2">
          <Card className={cx('flex items-center gap-3 !py-2 shadow-2xl')}>
            <span className="text-xs text-gray-300">Entry deleted</span>
            <Button
              variant="ghost"
              className="!px-2 !py-1 text-xs"
              onClick={async () => {
                const entry = state.entries.find((e) => e.id === undoId);
                setUndoId(null);
                if (!entry) return;
                await onSaveEntry(null, {
                  site: entry.site,
                  username: entry.username,
                  password: entry.password,
                  notes: entry.notes,
                });
              }}
            >
              Undo — re-add
            </Button>
          </Card>
        </div>
      ) : null}
    </main>
  );
}