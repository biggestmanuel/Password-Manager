/**
 * Client-side zero-knowledge cryptography.
 *
 * IMPORTANT: this module is imported by browser code only. Nothing in
 * here ever runs on the server, and the master password never leaves
 * the device it is typed on. That is the whole point of the design --
 * the server is a dumb, encrypted blob store.
 *
 * Key hierarchy:
 *
 *   master password
 *        |
 *        |  Argon2id (memory-hard, salted with params stored server-side)
 *        v
 *   root key (32 bytes)
 *        |
 *        |  HKDF-SHA256, split with distinct `info` labels
 *        +--> encryption key (AES-256-GCM, non-extractable)
 *        +--> verifier       (sent to server to prove login)
 *
 * The two derived values are separated by HKDF `info`, so possessing one
 * gives an attacker nothing toward the other.
 */

import { argon2id } from 'hash-wasm';
import type { VaultEntryPayload } from './types';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Argon2id cost parameters. ~64 MiB and 3 passes: deliberately slow. */
export const KDF_DEFAULTS = {
  algorithm: 'argon2id',
  memoryKiB: 65_536,
  iterations: 3,
  parallelism: 1,
} as const;

export type KdfParams = {
  algorithm: string;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
};

/** KDF parameters as they come back from the database. */
export type StoredKdfParams = KdfParams & { salt: string };

const HKDF_ENCRYPTION_INFO = 'vault-encryption-v1';
const HKDF_VERIFIER_INFO = 'vault-verifier-v1';

/** Minimum master-password length. Argon2id slows guessing, this bounds the obvious cases. */
export const MIN_MASTER_PASSWORD_LENGTH = 12;

// -------------------------------------------------------------------------
// base64 helpers
// -------------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  // Allocate through an explicit ArrayBuffer so the result is typed
  // `Uint8Array<ArrayBuffer>` rather than `Uint8Array<ArrayBufferLike>`.
  // Since TS 5.7 the generic parameter matters: Web Crypto's
  // `BufferSource` will not accept a view that might be backed by a
  // SharedArrayBuffer, so the narrower type has to be established here.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(length)));
}

// -------------------------------------------------------------------------
// Key derivation
// -------------------------------------------------------------------------

/**
 * Expand the master password into a 32-byte root key using Argon2id.
 *
 * Argon2id is memory-hard, which is the property that matters here: it
 * resists GPU and ASIC attacks far better than PBKDF2 or plain scrypt at
 * comparable cost. The salt is generated once at vault creation and stored
 * (a salt is not secret; storing it is required so every device derives
 * the same key).
 */
async function deriveRootKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  const output = await argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    hashLength: 32,
    outputType: 'binary',
  });
  return output;
}

/** Import raw root-key material as an HKDF base key. */
async function importHkdf(rootKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rootKey as BufferSource, 'HKDF', false, [
    'deriveBits',
    'deriveKey',
  ]);
}

/**
 * Turn the root key into the two things the vault actually needs.
 *
 * The encryption key is imported non-extractable: even if this module had
 * an XSS bug, `key.export()` would throw rather than handing raw key
 * bytes to the attacker.
 */
async function deriveFromRoot(
  rootKey: Uint8Array,
): Promise<{ encryptionKey: CryptoKey; verifier: string }> {
  const hkdf = await importHkdf(rootKey);

  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(HKDF_ENCRYPTION_INFO),
    },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt'],
  );

  const verifierBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: enc.encode(HKDF_VERIFIER_INFO),
    },
    hkdf,
    256,
  );

  return { encryptionKey, verifier: toBase64(new Uint8Array(verifierBits)) };
}

export type UnlockedVault = {
  /** Non-extractable AES-256-GCM key. Lives in memory only. */
  encryptionKey: CryptoKey;
  kdfParams: StoredKdfParams;
};

/**
 * First-run: generate fresh KDF parameters and unlock the vault.
 */
export async function createVaultKeys(password: string): Promise<UnlockedVault & { verifier: string }> {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    throw new Error(`Master password must be at least ${MIN_MASTER_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(16);
  const kdfParams: StoredKdfParams = {
    ...KDF_DEFAULTS,
    salt: toBase64(salt),
  };
  const rootKey = await deriveRootKey(password, salt, kdfParams);
  const { encryptionKey, verifier } = await deriveFromRoot(rootKey);
  return { encryptionKey, verifier, kdfParams };
}

/**
 * Unlock an existing vault. Uses the KDF parameters recorded server-side
 * so that raising the cost later does not break existing vaults.
 *
 * Throws if the password is wrong -- the verifier simply won't match.
 */
export async function unlockVault(password: string, kdfParams: StoredKdfParams): Promise<UnlockedVault & { verifier: string }> {
  const rootKey = await deriveRootKey(password, fromBase64(kdfParams.salt), kdfParams);
  const { encryptionKey, verifier } = await deriveFromRoot(rootKey);
  return { encryptionKey, verifier, kdfParams };
}

/**
 * One-way hash of the verifier. This is what the server stores.
 *
 * Hashing again on the server means a database dump does not hand the
 * attacker a ready-to-use login credential; recovering the password from
 * it requires running Argon2id over guesses, which is the intended
 * (expensive) cost of guessing a master password.
 */
export async function hashVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(verifier));
  return toBase64(new Uint8Array(digest));
}

// -------------------------------------------------------------------------
// Entry encryption
// -------------------------------------------------------------------------

/** The plaintext shape of a stored entry. All of it is encrypted together. */
export type { VaultEntryPayload } from './types';

export type EncryptedPayload = {
  payload: string;
  iv: string;
  authTag: string;
};

/**
 * Additional authenticated data binding a ciphertext to its row id.
 *
 * GCM authenticates the ciphertext, but without AAD an attacker with
 * database write access could copy row A's ciphertext into row B and it
 * would still decrypt cleanly. Binding the id means a swapped row fails
 * to authenticate.
 */
function aadFor(id: string): Uint8Array<ArrayBuffer> {
  return enc.encode(`vault-entry:${id}`) as Uint8Array<ArrayBuffer>;
}

export async function encryptEntry(
  id: string,
  data: VaultEntryPayload,
  key: CryptoKey,
): Promise<EncryptedPayload> {
  const iv = randomBytes(12); // 96-bit IV, the size GCM is defined for
  const plaintext = enc.encode(JSON.stringify(data));

  // Web Crypto appends the auth tag to the ciphertext; split them back out
  // so they can live in separate columns.
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadFor(id) }, key, plaintext),
  );

  const tagLength = 16;
  const ciphertext = sealed.subarray(0, sealed.length - tagLength);
  const authTag = sealed.subarray(sealed.length - tagLength);

  return {
    payload: toBase64(ciphertext),
    iv: toBase64(iv),
    authTag: toBase64(authTag),
  };
}

export async function decryptEntry(
  id: string,
  sealed: EncryptedPayload,
  key: CryptoKey,
): Promise<VaultEntryPayload> {
  // Re-assemble the ciphertext||tag layout that subtle.decrypt expects.
  const ciphertext = fromBase64(sealed.payload);
  const authTag = fromBase64(sealed.authTag);
  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext, 0);
  combined.set(authTag, ciphertext.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: aadFor(id) },
    key,
    combined,
  );

  return JSON.parse(dec.decode(plaintext)) as VaultEntryPayload;
}

// -------------------------------------------------------------------------
// Password generation
// -------------------------------------------------------------------------

const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';      // no 'l'
const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';       // no 'I', 'O'
const DIGITS = '23456789';                           // no '0', '1'
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';

export type GeneratorOptions = {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
};

/**
 * Generate a random password using a CSPRNG.
 *
 * Rejection sampling rather than `% alphabet.length`, because modulo
 * introduces modulo bias: with an alphabet of 31, values 0-30 would each
 * be ~3.2% more likely than 0 should be. Rejection sampling discards the
 * biased tail so every character is exactly equally likely.
 */
export function generatePassword(options: GeneratorOptions): string {
  const pools: string[] = [];
  if (options.lower) pools.push(LOWERCASE);
  if (options.upper) pools.push(UPPERCASE);
  if (options.digits) pools.push(DIGITS);
  if (options.symbols) pools.push(SYMBOLS);

  if (pools.length === 0) {
    throw new Error('Select at least one character set');
  }

  const alphabet = pools.join('');
  const out: string[] = [];

  // Guarantee at least one character from each selected set, so a
  // generated password always satisfies sites that demand a mix.
  for (const pool of pools) {
    out.push(pool[randomIndex(pool.length)] as string);
  }

  while (out.length < options.length) {
    out.push(alphabet[randomIndex(alphabet.length)] as string);
  }

  // Fisher-Yates with a CSPRNG. Array.prototype.sort(() => ...) is not a
  // shuffle -- it is biased and widely misused for exactly this purpose.
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    const a = out[i] as string;
    out[i] = out[j] as string;
    out[j] = a;
  }

  return out.slice(0, Math.max(options.length, pools.length)).join('');
}

/** Uniform integer in [0, max) via rejection sampling. */
function randomIndex(max: number): number {
  if (max <= 0) throw new Error('max must be positive');
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0] as number;
  } while (value >= limit);
  return value % max;
}

/**
 * Rough strength score for the UI meter. Intentionally approximate --
 * it is a nudge, not a security control.
 */
export function estimateStrength(password: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
} {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;

  const clamped = Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
  return { score: clamped, label: labels[clamped] };
}