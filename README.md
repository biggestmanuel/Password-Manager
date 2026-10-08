# Vault — zero-knowledge password manager

End-to-end encrypted password manager. Your master password and encryption key
never leave the browser; the server stores ciphertext it has no ability to read.

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 15 (App Router) | Server routes for the sync API, static client for the vault UI |
| Language | TypeScript (strict) | Crypto code fails silently when types are loose; this is not a place to be casual |
| Encryption | Web Crypto — AES-256-GCM | Native, constant-time, authenticated |
| Key derivation | Argon2id via `hash-wasm` | Memory-hard: resists GPU cracking far better than PBKDF2/scrypt at equal cost |
| KDF splitting | HKDF-SHA256 | One password, two independent keys; knowing one reveals nothing about the other |
| Database | Supabase Postgres | Managed Postgres with row-level security |
| Styling | Tailwind v4 | No runtime, no config file needed |

## Setup

### 1. Create the database

Create a project at [supabase.com](https://supabase.com), then run
[`supabase/schema.sql`](supabase/schema.sql) in the SQL editor.

### 2. Configure

```bash
cp .env.example .env.local
```

Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
**Project Settings → API**.

> Use the **`service_role`** key, not the `anon`/publishable key.
>
> Never prefix these variables with `NEXT_PUBLIC_`. That prefix inlines a
> value into the JavaScript bundle, making it readable by anyone who opens the
> page. The service-role key bypasses row-level security entirely, so leaking
> it hands over the whole vault.

### 3. Run

```bash
npm install
npm run dev
```

Open http://localhost:3000. The first visit creates your master password.

## How it works

```
master password
     │  Argon2id (64 MiB, 3 passes, salted — params stored server-side)
     ▼
   root key
     │  HKDF-SHA256, split by distinct `info` labels
     ├──► encryption key (AES-256-GCM, non-extractable, memory only)
     └──► verifier ──► SHA-256 ──► stored server-side
```

**Login without the server seeing the password.** Because the server never
receives the master password, it cannot hash it — which is why there is no
`bcrypt` in this project at all. Instead the browser sends a hash of the
verifier, and the server stores that. Matching hashes prove the caller can
derive the same key, which is exactly the capability needed to decrypt the
vault. Comparing them uses `timingSafeEqual` so response timing leaks nothing.

**Entries.** Site, username, password, and notes are encrypted together into a
single `payload` column. The server cannot read the site name either, so it
cannot even tell which services you have accounts with.

**Session.** The session cookie is an opaque random id, *not* the key. The key
lives in a React ref — deliberately not state, which is visible in React
DevTools — and is never persisted, so closing the tab requires re-entering the
master password. "Stay logged in" would mean storing the key where any XSS could
read it, which defeats the whole design. Sessions idle out after 20 minutes
(rolling) with a 12-hour absolute cap.

**Delete is a tombstone.** Deleting a row outright would be invisible to a
device that was offline at the time, silently resurrecting the entry on its next
sync. Deletes set `deleted_at` instead.

**Edits are optimistic.** Each write carries the revision it was based on. If
another device got there first the server returns `409` with the current row
instead of clobbering it.

## Verifying the crypto

`verify-crypto.ts` exercises the primitives directly — key derivation
determinism, round-trip fidelity, tamper detection, and generator uniformity:

```bash
node --experimental-strip-types verify-crypto.ts
```

All checks pass. Worth noting that tamper detection and AAD row-binding are
tested explicitly, because a silently-failing `decrypt` would be far worse than
a crash.

## Known limitations

These are deliberate scope boundaries, not oversights:

- **Single-user by design.** One master password, one `vault_meta` row. The
  schema will need a real user model for multi-account support.
- **Search is client-side.** The server cannot filter, because it cannot read.
  Fine for hundreds of entries; large vaults want a blind-index scheme, which
  is a substantial piece of work on its own.
- **Rate limiting trusts `x-forwarded-for`.** Durable and enforced, but an
  attacker controlling their own headers can mint fresh quotas. Real
  protection means edge-level throttling.
- **Clipboard clearing is best-effort.** Background tabs suspend timers, so the
  30-second clear can be delayed.
- **No password recovery.** By design. A forgotten master password means the
  entries are gone, which is the honest outcome for a zero-knowledge vault
  rather than a backdoor.
- **No 2FA.** The single master password is a single point of compromise.