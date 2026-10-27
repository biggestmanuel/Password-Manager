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

## Backend status — this session

All API routes and server lib modules were migrated from JavaScript to TypeScript (strict):

- `app/api/auth/{login,logout,setup,status}/route.ts` — session create/verify/destroy/status
- `app/api/entries/route.ts` — delta sync (GET) and create (POST)
- `app/api/entries/[id]/route.ts` — optimistic update (PATCH, `409` on conflict) and tombstone delete (DELETE)
- `lib/{api,session,supabase,rate-limit,types}.ts` — validation schemas, constant-time secret comparison, server-only Supabase client, rolling + absolute session timeouts, durable DB rate limiting

Verification (all green):
- `tsc --noEmit` — clean
- `next build` — green
- `verify-crypto.ts` — all checks pass (round trip, tamper detection, AAD binding, generator)

Security invariants hold: the service-role key stays server-side (`import 'server-only'`, no `NEXT_PUBLIC_` prefix), RLS is enabled with zero policies, and the encryption key never leaves the browser.

## Code review — full stack

### Backend (API + server lib)
All six API routes and five server lib modules reviewed. Every route handles ciphertext only — no plaintext site, username, password, or notes ever reaches the server. Session cookie is an opaque random id (not the key), with a 20-minute rolling idle timeout and a 12-hour absolute cap. Login verifies a SHA-256 verifier hash in constant time (`timingSafeEqual`). Rate limiting is durable (DB-backed `vault_login_attempts`, fails closed on DB blips) at 10 attempts per 15 minutes. All lib modules carry `import 'server-only'` so the service-role key can never be bundled into client JS.

### Frontend / client
- `lib/vault-crypto.ts` — Argon2id root key, HKDF-SHA256 split into a non-extractable AES-256-GCM encryption key and a login verifier; AES-GCM ciphertext bound to the entry id as AAD (row-swap tampering fails authentication); CSPRNG password generator with rejection sampling (no modulo bias) and Fisher-Yates shuffling.
- `lib/vault-client.ts` — same-origin fetch only (CSP `connect-src 'self'`), throws `AuthError` on 401 so the UI can distinguish session expiry from other failures.
- `lib/use-vault.ts` — encryption key held in a `useRef`, never React state (DevTools-safe) and never persisted; authenticates before adopting the key; delta sync merges changed rows and applies tombstones; syncs on a 30s interval and on window focus.
- `components/` — clipboard copy with best-effort 30s clear; delete-with-confirm and undo; client-side search over decrypted data (inherent to zero-knowledge); password strength meter is advisory only.

### Bug fixed this session
First-run setup discarded the encryption key: `VaultApp` was keyed by `status.vaultExists`, so when setup flipped `vaultExists` `false → true` the component remounted and `useVault`'s in-memory key (a ref, never persisted) was lost. The user was left "unlocked" with an empty, unsyncable vault. Fixed by removing the key so `VaultApp` persists across the transition, and running an immediate sync after setup.

### Verification (all green)
- `tsc --noEmit` — clean
- `next build` — green
- `verify-crypto.ts` — all checks pass (round trip, tamper detection, AAD binding, generator)

### Secrets review (pre-commit, clean)
No real credentials anywhere: `package-lock.json` `integrity` hashes are published npm hashes, not secrets (documented false positive). `.env.example` contains placeholders only; no `.env`/`.pem`/etc. is tracked; no private variable uses a `NEXT_PUBLIC_` prefix.

What's left (scope boundaries, not bugs):

- Multi-user model (currently one `vault_meta` row)
- Blind-index search (the server cannot filter ciphertext)
- Edge-level rate limiting (current limiter trusts `x-forwarded-for`)
- Password recovery and 2FA (deliberately out of scope for a zero-knowledge vault)