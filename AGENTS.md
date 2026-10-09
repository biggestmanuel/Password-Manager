# AGENTS.md

Working agreements for this repository. Read before making changes.

## Core workflow

**After every file change, commit and push.**

No batching changes into one large commit at the end. Each logical change
gets its own commit and is pushed as soon as it passes verification. This
keeps history bisectable and means a broken push never strands unsaved work.

Before every commit and push:

1. **Run the code review for hidden keys** (below). This is mandatory and
   non-optional.
2. **Run verification.** All three must pass:
   ```bash
   npx tsc --noEmit
   npm run build
   node --experimental-strip-types verify-crypto.ts
   ```
3. **Check what will actually be committed.** Never `git add -A` without
   reading the output:
   ```bash
   git add -A
   git status --short        # read every line
   ```

## Code review for hidden keys — required before every commit/push

This project handles a credential that can read the entire user vault: the
Supabase **service-role** key. It bypasses row-level security completely. A
single leaked copy means every vault in the database is readable and
rewritable by anyone, with no need to touch the application at all.

Treat any commit that could introduce a leak as a failed commit.

### Run all three checks

```bash
# 1. Secrets in files staged for commit
git diff --cached --name-only
git diff --cached | grep -nEi '(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)[[:space:]]*[=:][[:space:]]*["'"'"'][^"'"'"']{12,}'

# 2. Secrets anywhere in history (catches a leak in an earlier commit)
git grep -InE 'eyJ[A-Za-z0-9_-]{20,}|sb_secret_[A-Za-z0-9]+|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}' -- .

# 3. Confirm nothing sensitive is tracked at all
git ls-files | grep -Ei '\.env$|\.env\.local$|\.pem$|\.key$|\.p12$|id_rsa|credentials'
```

The `package-lock.json` `"integrity": "sha512-..."` lines match the first
check's pattern. Those are published npm hashes, not secrets. Ignore them
and say so explicitly rather than passing in silence.

### Manual review checklist

- [ ] No real credential value anywhere. Placeholders only
      (`your-service-role-key`, `xxx`, `<...>`).
- [ ] No environment variable that should be private uses a
      `NEXT_PUBLIC_` prefix. That prefix inlines the value into the
      JavaScript bundle, making it public to anyone who loads the page.
      Only genuinely public values may carry it.
- [ ] `.env`, `.env.local`, `*.pem`, `*.key` are untracked and covered by
      `.gitignore`.
- [ ] `.env.example` contains placeholders only, never a working value.
- [ ] No secret is echoed to a log, `console.log`, or an error message.
- [ ] No secret appears in a URL, query string, or referrer header.
- [ ] Server-only modules keep `import 'server-only'`.
- [ ] Test fixtures use obviously fake values.

## Security invariants

Breaking any of these breaks the product's core promise. Do not relax them
to make something easier.

- **The master password never reaches the server.** No hashing it server-side,
  no logging it, no accepting it in a request body. All KDF work happens in
  the browser.
- **The server cannot decrypt entries.** It stores ciphertext and nothing
  more. If a feature seems to require the server reading a plaintext entry,
  the feature is wrong, not the architecture.
- **RLS stays enabled with zero policies** for `anon`/`authenticated`.
  Absence of a policy is what denies access. Adding a `using (true)` policy
  reopens the hole this project was built to close.
- **The service-role key stays server-side.** No `NEXT_PUBLIC_` prefix, ever.
- **The encryption key is never persisted.** Not to `localStorage`, not to a
  cookie, not to IndexedDB. It lives in a React ref for the session only.
  "Remember me" is out of scope precisely because it would require storing
  the key.
- **Fails are loud.** Never render partial data from a failed
  authentication, and never silently swallow a decryption error.
- **New randomness comes from the CSPRNG** (`crypto.getRandomValues`), never
  `Math.random`.

## Verification expectations

- `verify-crypto.ts` must stay passing. Add a case for any new crypto
  behaviour, especially failure paths: wrong key, tampered ciphertext, row
  swapped under a different ID.
- `tsc --noEmit` is clean. Type errors in crypto or entry-handling code
  frequently indicate real bugs, not just type noise.
- A green build is necessary, not sufficient. It does not prove the crypto
  is correct or that no key leaked.

## Known environment quirks

- PowerShell blocks `npm.ps1`. Use `npm.cmd` and `npx.cmd`.
- TypeScript sources import without extensions and rely on the bundler.
  Run Node scripts with `--experimental-strip-types`.