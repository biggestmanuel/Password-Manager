'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createVault,
  deleteEntry as deleteEntryRequest,
  login as loginRequest,
  logout as logoutRequest,
  patchEntry,
  putEntry,
  syncEntries,
  ApiError,
  AuthError,
} from './vault-client';
import {
  decryptEntry,
  encryptEntry,
  createVaultKeys,
  hashVerifier,
  unlockVault,
  type VaultEntryPayload,
} from './vault-crypto';
import type { DecryptedEntry, StoredEntry, VaultStatus } from './types';

/** How often to pull remote changes while the vault is open. */
const SYNC_INTERVAL_MS = 30_000;

export type UndoState = { entry: DecryptedEntry; timeout: number } | null;

export type VaultState = {
  entries: DecryptedEntry[];
  loading: boolean;
  syncing: boolean;
  /** Entries that failed to decrypt, e.g. after a wrong-key or data issue. */
  undecryptable: number;
  error: string | null;
  lastSyncedAt: string | null;
};

const INITIAL: VaultState = {
  entries: [],
  loading: true,
  syncing: false,
  undecryptable: 0,
  error: null,
  lastSyncedAt: null,
};

/**
 * Owns the unlocked vault in the browser.
 *
 * The AES key is held in a `useRef`, not `useState`, on purpose. React
 * state is visible in the React DevTools panel and can be captured in
 * component snapshots and error reports; a ref keeps the raw key out of
 * that surface. It is also deliberately not persisted anywhere -- closing
 * or reloading the tab discards it and the master password must be
 * re-entered. Persisting it to localStorage to "stay logged in" would put
 * the master encryption key in a place any XSS could read, which is
 * exactly what zero-knowledge is meant to prevent.
 */
export function useVault(status: VaultStatus) {
  const keyRef = useRef<CryptoKey | null>(null);
  const syncCursorRef = useRef<string | undefined>(undefined);

  const [state, setState] = useState<VaultState>(INITIAL);
  const onSessionLostRef = useRef<() => void>(() => {});

  const setError = useCallback((message: string | null) => {
    setState((prev) => ({ ...prev, error: message }));
  }, []);

  // --- sync ------------------------------------------------------------

  const runSync = useCallback(async () => {
    if (!keyRef.current) return;
    setState((prev) => ({ ...prev, syncing: true, error: null }));

    try {
      const response = await syncEntries(syncCursorRef.current);
      const key = keyRef.current;
      if (!key) return;

      let undecryptable = 0;
      const decrypted = new Map<string, DecryptedEntry>();

      for (const stored of response.entries) {
        if (stored.deletedAt) continue; // tombstone: drop it locally
        try {
          const plain = await decryptEntry(stored.id, stored, key);
          decrypted.set(stored.id, { ...plain, id: stored.id, revision: stored.revision, updatedAt: stored.updatedAt });
        } catch {
          // GCM authentication failed: wrong key, or the row was tampered
          // with. Never render partial data from a failed authentication.
          undecryptable += 1;
        }
      }

      // A delta sync only returns changed rows, so merge rather than
      // replace -- otherwise untouched entries would disappear from the UI.
      setState((prev) => {
        const merged = new Map<string, DecryptedEntry>();
        if (syncCursorRef.current) {
          for (const entry of prev.entries) merged.set(entry.id, entry);
        }
        for (const [id, entry] of decrypted) merged.set(id, entry);
        // Tombstones must actively remove the local copy.
        for (const stored of response.entries) {
          if (stored.deletedAt) merged.delete(stored.id);
        }
        return {
          ...prev,
          entries: [...merged.values()].sort((a, b) => a.site.localeCompare(b.site)),
          undecryptable,
          syncing: false,
          loading: false,
          lastSyncedAt: response.syncedAt,
        };
      });

      syncCursorRef.current = response.syncedAt;
    } catch (error) {
      if (error instanceof AuthError) {
        onSessionLostRef.current();
        return;
      }
      setState((prev) => ({
        ...prev,
        syncing: false,
        loading: false,
        error: error instanceof Error ? error.message : 'Sync failed',
      }));
    }
  }, []);

  // Register the session-lost handler without making runSync depend on it,
  // which would otherwise recreate the callback on every render.
  const registerSessionLost = useCallback((handler: () => void) => {
    onSessionLostRef.current = handler;
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      if (!status.kdf) throw new Error('Vault is not set up yet');

      const { encryptionKey, verifier } = await unlockVault(password, status.kdf);
      const verifierHash = await hashVerifier(verifier);

      // Authenticate FIRST, before adopting the key. If the password is
      // wrong the request is rejected and we never hold a key that cannot
      // open anything.
      await loginRequest(verifierHash);

      keyRef.current = encryptionKey;
      syncCursorRef.current = undefined;
      await runSync();
    },
    [status.kdf, runSync],
  );

  const setup = useCallback(async (password: string) => {
    const { encryptionKey, verifier, kdfParams } = await createVaultKeys(password);
    const verifierHash = await hashVerifier(verifier);

    await createVault(verifierHash, {
      algorithm: kdfParams.algorithm,
      salt: kdfParams.salt,
      memoryKiB: kdfParams.memoryKiB,
      iterations: kdfParams.iterations,
      parallelism: kdfParams.parallelism,
    });

    keyRef.current = encryptionKey;
    syncCursorRef.current = undefined;
  }, []);

  const lock = useCallback(async () => {
    keyRef.current = null;
    syncCursorRef.current = undefined;
    setState(INITIAL);
    try {
      await logoutRequest();
    } catch {
      // The local key is already gone; a failed logout request just means
      // the server session lingers until its idle timeout.
    }
  }, []);

  // --- entry CRUD ------------------------------------------------------

  const addEntry = useCallback(
    async (data: VaultEntryPayload) => {
      const key = keyRef.current;
      if (!key) throw new Error('Vault is locked');

      // Client-generated so the id can be bound into the ciphertext as
      // additional authenticated data.
      const id = crypto.randomUUID();
      const sealed = await encryptEntry(id, data, key);
      const stored: StoredEntry = {
        id,
        ...sealed,
        revision: 1,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await putEntry(stored);
      setState((prev) => ({
        ...prev,
        entries: [...prev.entries, { ...data, id, revision: 1, updatedAt: stored.updatedAt }].sort((a, b) =>
          a.site.localeCompare(b.site),
        ),
      }));
    },
    [],
  );

  const updateEntry = useCallback(async (id: string, data: VaultEntryPayload) => {
    const key = keyRef.current;
    const current = state.entries.find((entry) => entry.id === id);
    if (!key || !current) throw new Error('Entry not found');

    const sealed = await encryptEntry(id, data, key);
    const response = await patchEntry(id, sealed, current.revision);

    setState((prev) => ({
      ...prev,
      entries: prev.entries
        .map((entry) =>
          entry.id === id
            ? { ...data, id, revision: response.entry.revision, updatedAt: response.entry.updatedAt }
            : entry,
        )
        .sort((a, b) => a.site.localeCompare(b.site)),
    }));
  }, [state.entries]);

  const removeEntry = useCallback(async (id: string) => {
    const removed = state.entries.find((entry) => entry.id === id);

    await deleteEntryRequest(id);

    setState((prev) => ({ ...prev, entries: prev.entries.filter((entry) => entry.id !== id) }));
    return removed ?? null;
  }, [state.entries]);

  // --- periodic + focus-triggered sync ---------------------------------

  useEffect(() => {
    if (!keyRef.current) return;

    const interval = setInterval(() => void runSync(), SYNC_INTERVAL_MS);

    // Syncing on focus catches changes made on a phone while the tab was
    // backgrounded, without polling constantly.
    const onFocus = () => void runSync();
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [runSync, state.entries.length, state.lastSyncedAt]);

  return {
    state,
    setError,
    unlock,
    setup,
    lock,
    runSync,
    addEntry,
    updateEntry,
    removeEntry,
    registerSessionLost,
  };
}

/** Format a timestamp as a short relative string for the sync indicator. */
export function formatSyncedAt(iso: string | null): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export { ApiError, AuthError };
