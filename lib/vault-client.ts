/**
 * Browser-side API client.
 *
 * Everything here deals exclusively in ciphertext. The master password and
 * the encryption key never cross the network, and the server never sees
 * either of them.
 */

import type { StoredEntry, SyncResponse, VaultStatus } from './types';

export class AuthError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'AuthError';
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    throw new AuthError();
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(data?.error ?? `Request failed (${response.status})`, response.status, data);
  }

  return data as T;
}

// --- Auth ---------------------------------------------------------------

export function fetchStatus(): Promise<VaultStatus> {
  return request<VaultStatus>('/api/auth/status');
}

export async function createVault(verifierHash: string, kdf: VaultStatus['kdf']): Promise<void> {
  await request('/api/auth/setup', {
    method: 'POST',
    body: JSON.stringify({ verifierHash, kdf }),
  });
}

export async function login(verifierHash: string): Promise<void> {
  await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ verifierHash }),
  });
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

// --- Entries ------------------------------------------------------------

/** Create the vault: derive keys, send only the verifier hash. */
export function putEntry(entry: StoredEntry): Promise<{ id: string }> {
  return request('/api/entries', {
    method: 'POST',
    body: JSON.stringify({
      id: entry.id,
      payload: entry.payload,
      iv: entry.iv,
      authTag: entry.authTag,
    }),
  });
}

export function patchEntry(
  id: string,
  entry: Pick<StoredEntry, 'payload' | 'iv' | 'authTag'>,
  baseRevision: number,
): Promise<{ entry: StoredEntry }> {
  return request(`/api/entries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ ...entry, baseRevision }),
  });
}

export function deleteEntry(id: string): Promise<{ success: true }> {
  return request(`/api/entries/${id}`, { method: 'DELETE' });
}

export function syncEntries(since?: string): Promise<SyncResponse> {
  const query = since ? `?since=${encodeURIComponent(since)}` : '';
  return request<SyncResponse>(`/api/entries${query}`);
}