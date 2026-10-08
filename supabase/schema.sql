-- =====================================================================
-- Zero-knowledge vault schema.
--
-- SECURITY MODEL: this database stores ONLY ciphertext. The master
-- password never leaves the browser, so there is nothing here an
-- attacker with full read access can decrypt.
--
-- The critical part is the RLS lockdown at the bottom: RLS is enabled
-- on every table and NO policies are granted to anon/authenticated.
-- That means the public anon key (which ships in the browser bundle and
-- is therefore public to anyone) grants ZERO access. The server uses
-- the service-role key, which bypasses RLS, and that key is never
-- exposed to the client.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- vault_meta: singleton row (id = 1) holding the KDF parameters and the
-- login verifier.
--
-- Note there is NO password_hash column. In a zero-knowledge design the
-- server never receives the master password, so it could not hash it even
-- if it wanted to. Verification happens with a one-way verifier derived
-- from the key instead (see lib/vault-crypto.ts).
-- ---------------------------------------------------------------------
create table if not exists vault_meta (
  id                  int primary key default 1,
  -- SHA-256 of the client-side verifier. Lets the server confirm "you
  -- know the master password" without ever seeing it.
  verifier_hash       text not null,
  -- KDF parameters are stored so any device can reproduce the key, and
  -- so we can raise the cost later without breaking existing vaults.
  kdf_algorithm       text not null default 'argon2id',
  kdf_salt            text not null,
  kdf_memory_kib      int  not null,
  kdf_iterations      int  not null,
  kdf_parallelism     int  not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint vault_meta_singleton check (id = 1)
);

-- ---------------------------------------------------------------------
-- vault_entries: one row per saved login.
--
-- `payload` is AES-256-GCM ciphertext of a JSON object containing site,
-- username, password and notes. The server cannot read ANY of it --
-- not even the site name, so it cannot even tell which services you use.
-- ---------------------------------------------------------------------
create table if not exists vault_entries (
  id            uuid primary key default gen_random_uuid(),
  payload       text not null,
  iv            text not null,
  auth_tag      text not null,
  -- Monotonic per-row revision, bumped by the app on every write.
  -- Lets clients resolve concurrent edits during sync.
  revision      int  not null default 1,
  -- Soft delete. Hard-deleting a row would make it invisible to a device
  -- that is offline at the time, which would let a deletion be silently
  -- resurrected on next sync. Tombstones keep deletes in sync.
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Partial index: sync almost always wants "changed since X, still live".
create index if not exists vault_entries_updated_at_idx
  on vault_entries (updated_at);

-- ---------------------------------------------------------------------
-- vault_sessions: server-side session records.
--
-- The session is an opaque random id in an httpOnly cookie. It is NOT
-- the encryption key -- under zero-knowledge the key lives only in the
-- browser's memory, so the server can never decrypt anything even while
-- a session is active.
--
-- Server-side (rather than a self-contained JWT) specifically so sessions
-- can be revoked and so the idle timeout can be enforced authoritatively.
-- ---------------------------------------------------------------------
create table if not exists vault_sessions (
  id           text primary key,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists vault_sessions_expires_at_idx
  on vault_sessions (expires_at);

-- ---------------------------------------------------------------------
-- vault_login_attempts: failed master-password attempts, used for
-- rate limiting.
--
-- Stored in the database rather than in process memory on purpose: on a
-- serverless or multi-instance deploy an in-memory counter is per-machine
-- and gets reset on every cold start, so an attacker could simply retry
-- until a new instance spun up. A durable counter is the only version of
-- this that actually holds.
-- ---------------------------------------------------------------------
create table if not exists vault_login_attempts (
  id        bigserial primary key,
  client_id text not null,
  failed_at timestamptz not null default now()
);

create index if not exists vault_login_attempts_lookup_idx
  on vault_login_attempts (client_id, failed_at desc);

-- =====================================================================
-- ROW LEVEL SECURITY LOCKDOWN
--
-- Enabling RLS with no policies denies everything to anon/authenticated.
-- Only service_role (used exclusively by the Next.js server) can read or
-- write. This is what closes the hole in the previous version of this
-- project, where `using (true)` policies let anyone holding the public
-- anon key read and rewrite the whole vault directly through the REST
-- API.
-- =====================================================================
alter table vault_meta           enable row level security;
alter table vault_entries        enable row level security;
alter table vault_sessions       enable row level security;
alter table vault_login_attempts enable row level security;

-- Deliberately NO create policy statements. Absence of a policy means
-- deny-all for non-service_role roles.