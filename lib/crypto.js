import crypto from 'crypto';

const KEYLEN = 32; // 256-bit key, required by AES-256

// ---------------------------------------------------------------------
// Master password: HASHED (one-way), via bcryptjs in the auth routes.
// You never need the master password back — you only ever need to
// check "does this input match what was set." Hashing is exactly that:
// irreversible by design, slow by design (bcrypt's cost factor), and
// salted automatically so two users with the same password get
// different hashes. There is no decrypt() for this side of the app.
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Vault key derivation: turns the master password into a symmetric
// AES key using scrypt (a KDF, not a hash function used for auth).
// Same password + same salt -> same key, every time. We only ever
// store the salt (in vault_config) — never the derived key, never the
// master password. The key exists only transiently, in memory, for
// the duration of a login.
// ---------------------------------------------------------------------
export function deriveVaultKey(masterPassword, saltBase64) {
  const salt = Buffer.from(saltBase64, 'base64');
  return crypto.scryptSync(masterPassword, salt, KEYLEN);
}

export function generateSalt() {
  return crypto.randomBytes(16).toString('base64');
}

// ---------------------------------------------------------------------
// Entry encryption: ENCRYPTED (two-way), via AES-256-GCM. Unlike the
// master password, we DO need these back in plaintext to be useful —
// that's the whole difference between "hash" and "encrypt" in one
// sentence. GCM mode also gives an auth tag, which detects tampering:
// decrypt() throws if the ciphertext was altered, not just silently
// returns garbage.
// ---------------------------------------------------------------------
export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

export function decrypt({ ciphertext, iv, authTag }, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

// ---------------------------------------------------------------------
// Session cookie wrapping: the derived vault key has to live SOMEWHERE
// between requests, or you'd have to re-enter your master password on
// every click. It is never written to the database or disk. Instead
// it's encrypted (again, AES-256-GCM) with a server-only secret
// (SESSION_SECRET, from env) and stored in an httpOnly cookie —
// invisible to browser JS, sent only over HTTPS, and only readable by
// this server. This is also why changing SESSION_SECRET logs everyone
// out: the cookie becomes undecryptable.
// ---------------------------------------------------------------------
function sessionCipherKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return crypto.scryptSync(secret, 'vault-session-fixed-salt', KEYLEN);
}

export function packSessionCookie(vaultKeyBuffer) {
  const key = sessionCipherKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(vaultKeyBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

export function unpackSessionCookie(packedBase64) {
  const key = sessionCipherKey();
  const packed = Buffer.from(packedBase64, 'base64');
  const iv = packed.subarray(0, 12);
  const authTag = packed.subarray(12, 28);
  const encrypted = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
