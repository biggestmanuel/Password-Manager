# Password Manager (Vault)

A single-user password vault. Master password is **hashed** (bcrypt).
Stored entries are **encrypted** (AES-256-GCM), with the encryption key
derived from your master password and never stored anywhere. Zero cost
on free tiers.

## 1. Create a Supabase project

Same as before: supabase.com -> new project -> free tier -> wait for
provisioning. Then run this in the SQL Editor:

```sql
create table vault_config (
  id int primary key default 1,
  password_hash text not null,
  salt text not null,
  created_at timestamptz not null default now(),
  constraint singleton check (id = 1)
);

create table vault_entries (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  username text,
  encrypted_password text not null,
  iv text not null,
  auth_tag text not null,
  notes text,
  created_at timestamptz not null default now()
);

alter table vault_config enable row level security;
alter table vault_entries enable row level security;

-- Learning-project shortcut: allow all access via the anon key, since
-- auth here is custom (master password), not Supabase's own auth.
-- In a real multi-user app you would NOT do this — see note below.
create policy "Allow all access to vault_config" on vault_config for all using (true) with check (true);
create policy "Allow all access to vault_entries" on vault_entries for all using (true) with check (true);
```

## 2. Configure the app

```bash
cp .env.example .env.local
```

Fill in your Supabase URL + anon key, and generate a session secret:

```bash
openssl rand -hex 32
```

Paste that into `SESSION_SECRET` in `.env.local`.

## 3. Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000. First visit creates your master password.
Every visit after that, you unlock with it.

## Hashing vs. encryption — the actual point of this project

These solve two different problems and this codebase keeps them
physically separate:

- **Master password -> `bcrypt.hash()`** (`app/api/auth/setup/route.js`).
  One-way. You never need the master password back — you only ever
  need to check "does this match." bcrypt is slow on purpose (cost
  factor 12) so brute-forcing guesses is expensive, and it salts
  automatically so identical passwords don't produce identical hashes.
  There is no `bcrypt.decrypt()` — it doesn't exist, because hashing
  isn't reversible.

- **Stored entry passwords -> AES-256-GCM** (`lib/crypto.js`,
  `encrypt`/`decrypt`). Two-way. You need the actual password back to
  autofill/copy it, so it has to be reversible — that's encryption,
  not hashing. The key comes from `deriveVaultKey()`, which runs
  `scrypt` on your master password + a stored salt. Same password +
  same salt = same key, always — so the key is never itself stored,
  only recomputed each time you log in.

- **Where the key lives in between**: after login, the derived key is
  wrapped in its own AES-256-GCM envelope (encrypted with a
  server-only `SESSION_SECRET`) and set as an **httpOnly cookie** —
  invisible to browser JS, sent only over HTTPS, never touching disk
  or the database. Every API call to `/api/entries` decrypts that
  cookie to get the key back into memory just long enough to
  encrypt/decrypt that one request.

## Known limitations (worth understanding, not fixing today)

- **RLS is wide open.** The `using (true)` policies mean anyone with
  your anon key can read/write these tables directly, bypassing your
  app entirely. Fine for a solo local project; in production you'd
  scope this to a real authenticated user via Supabase Auth or a
  service-role key kept server-side only.
- **No rate limiting on login.** A real vault would lock out or
  slow down repeated failed master-password attempts. This one
  doesn't — a good stretch goal.
- **Session is a fixed 20-minute cookie, not a rolling idle timer.**
  It expires 20 minutes after login regardless of activity. A rolling
  timeout (reset on each request) is a small, worthwhile upgrade.
- **Notes are stored in plaintext.** Only the password field is
  encrypted, to keep the first pass scoped. Encrypting notes too is a
  one-line change once you're comfortable with the pattern.

## Folder structure

```
lib/crypto.js                 hashing/encryption/session-cookie logic — read this file first
lib/session.js                pulls the vault key out of the request cookie
app/api/auth/setup/route.js   first-run: create master password
app/api/auth/login/route.js   verify master password, start session
app/api/auth/logout/route.js  clear session
app/api/auth/status/route.js  tells frontend which screen to show
app/api/entries/route.js      list (decrypt) / create (encrypt)
app/api/entries/[id]/route.js update / delete
app/page.js                   setup screen -> login screen -> vault UI
```
# Password-Manager
