'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input } from './ui';
import { StrengthMeter } from './StrengthMeter';
import { MIN_MASTER_PASSWORD_LENGTH } from '@/lib/vault-crypto';

export function AuthScreen({
  mode,
  onSubmit,
}: {
  mode: 'setup' | 'login';
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSetup = mode === 'setup';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
        setError(`Use at least ${MIN_MASTER_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/15 text-xl">
            🔐
          </div>
          <h1 className="text-lg font-semibold text-white">
            {isSetup ? 'Create your vault' : 'Unlock your vault'}
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            {isSetup
              ? 'Your entries are encrypted on this device before they are saved.'
              : 'Enter your master password to decrypt your vault locally.'}
          </p>
        </div>

        <Card className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="master-password" className="block text-xs font-medium text-gray-400">
                Master password
              </label>
              <Input
                id="master-password"
                type="password"
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                required
              />
              {isSetup ? <StrengthMeter password={password} /> : null}
            </div>

            {isSetup ? (
              <div className="space-y-1.5">
                <label htmlFor="confirm-password" className="block text-xs font-medium text-gray-400">
                  Confirm master password
                </label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                />
              </div>
            ) : null}

            {error ? <Alert>{error}</Alert> : null}

            <Button type="submit" disabled={busy || !password} className="w-full">
              {busy ? 'Working...' : isSetup ? 'Create vault' : 'Unlock'}
            </Button>
          </form>
        </Card>

        {/* The trust claim, stated explicitly. It is the single most
            important property of this design, so it should be verifiable
            by the user rather than buried in a README. */}
        <p className="mt-4 text-center text-[11px] leading-relaxed text-gray-500">
          End-to-end encrypted. Your master password and encryption key never leave this
          browser — the server only ever stores unreadable ciphertext.
        </p>

        {isSetup ? (
          <p className="mt-3 text-center text-[11px] leading-relaxed text-amber-500/80">
            There is no password reset. If you forget this, your entries are unrecoverable by
            design.
          </p>
        ) : null}
      </div>
    </div>
  );
}