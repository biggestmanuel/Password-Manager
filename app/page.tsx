'use client';

import { useCallback, useEffect, useState } from 'react';
import { AuthScreen } from '@/components/AuthScreen';
import { VaultScreen } from '@/components/VaultScreen';
import { useVault } from '@/lib/use-vault';
import { fetchStatus, AuthError } from '@/lib/vault-client';
import type { DecryptedEntry, VaultEntryPayload, VaultStatus } from '@/lib/types';

export default function Home() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await fetchStatus());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (failed) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <h1 className="text-base font-semibold text-white">Cannot reach the server</h1>
          <p className="mt-2 text-xs text-gray-400">
            Check that the app is running and that Supabase is configured. See the README for the
            setup steps.
          </p>
          <button
            onClick={() => void refresh()}
            className="mt-4 rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-100 hover:bg-gray-700"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  // Split out so the hook is never called conditionally across renders.
  return <VaultApp key={status.vaultExists ? 'setup-or-login' : 'new'} status={status} onRefresh={refresh} />;
}

function VaultApp({ status, onRefresh }: { status: VaultStatus; onRefresh: () => Promise<void> }) {
  const vault = useVault(status);
  const [unlocked, setUnlocked] = useState(false);

  // When the session dies server-side (idle timeout), drop the local key
  // and send the user back to the unlock screen rather than leaving a
  // decrypted-looking UI on screen that can no longer sync.
  useEffect(() => {
    vault.registerSessionLost(() => {
      setUnlocked(false);
      void onRefresh();
    });
  }, [vault.registerSessionLost, onRefresh]);

  async function handleAuth(password: string) {
    if (status.vaultExists) {
      await vault.unlock(password);
    } else {
      await vault.setup(password);
      await onRefresh();
    }
    setUnlocked(true);
  }

  async function handleSave(entry: DecryptedEntry | null, data: VaultEntryPayload) {
    if (entry) {
      await vault.updateEntry(entry.id, data);
    } else {
      await vault.addEntry(data);
    }
  }

  if (!unlocked) {
    return (
      <AuthScreen
        mode={status.vaultExists ? 'login' : 'setup'}
        onSubmit={handleAuth}
      />
    );
  }

  return (
    <VaultScreen
      state={vault.state}
      onSaveEntry={handleSave}
      onDeleteEntry={async (id) => {
        try {
          await vault.removeEntry(id);
        } catch (error) {
          // A dead session must send us back to the unlock screen, not
          // leave a stale vault on screen.
          if (error instanceof AuthError) {
            setUnlocked(false);
            void onRefresh();
            return;
          }
          throw error;
        }
      }}
      onSync={async () => {
        try {
          await vault.runSync();
        } catch (error) {
          if (error instanceof AuthError) {
            setUnlocked(false);
            void onRefresh();
          }
        }
      }}
      onLock={async () => {
        await vault.lock();
        setUnlocked(false);
        void onRefresh();
      }}
    />
  );
}