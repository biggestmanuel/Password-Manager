/**
 * Types shared between the browser and the API routes.
 *
 * Note what is NOT here: any plaintext field. Entries cross the network as
 * ciphertext only, and are decrypted in the browser.
 */

/**
 * The plaintext shape of a stored entry.
 *
 * Every field is encrypted together into a single `payload` column, so
 * the server cannot read the site name either -- it cannot even tell which
 * services you have accounts with.
 */
export type VaultEntryPayload = {
  site: string;
  username: string;
  password: string;
  notes: string;
};

/** An entry exactly as it sits in the database: opaque. */
export type StoredEntry = {
  id: string;
  payload: string;
  iv: string;
  authTag: string;
  revision: number;
  deletedAt: string | null;
  updatedAt: string;
  createdAt: string;
};

/** An entry after the browser has decrypted it. */
export type DecryptedEntry = {
  id: string;
  revision: number;
  site: string;
  username: string;
  password: string;
  notes: string;
  updatedAt: string;
};

export type VaultStatus = {
  vaultExists: boolean;
  authenticated: boolean;
  /** Sent to the browser so it can derive the key. Safe to expose: a salt is not secret. */
  kdf: {
    algorithm: string;
    salt: string;
    memoryKiB: number;
    iterations: number;
    parallelism: number;
  } | null;
};

/**
 * A sync response. Includes tombstones so deletions propagate to devices
 * that were offline.
 */
export type SyncResponse = {
  entries: StoredEntry[];
  /** Server time, for the next delta-sync cursor. */
  syncedAt: string;
};

export type ApiError = {
  error: string;
};