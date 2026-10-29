# AGENTS.md

Working agreements for this repository. Read before making changes. This file
is a local working agreement — it is gitignored and must never be committed or
pushed (rule 0.1).

## Project specifics

**Stack:** Next.js 15 (App Router, TypeScript strict), Tailwind v4, Supabase
Postgres (service-role key server-side only), Web Crypto AES-256-GCM, Argon2id
via `hash-wasm`, HKDF-SHA256 key splitting.

**Zero-knowledge vault:** Encryption happens only in the browser. The server
stores ciphertext it cannot read — including site names. The master password
never reaches the server; there is no `bcrypt` on the server side. Login uses a
verifier hash compared in constant time.

**Folder conventions:**
- `app/` — Next.js App Router (pages + API routes)
- `app/api/` — server API routes (all ciphertext-only; service-role Supabase client)
- `components/` — React client components
- `lib/` — shared client/server lib modules (`server-only` modules carry the import)
- `supabase/schema.sql` — database schema (RLS enabled, zero policies)

**Run/test/lint/build commands:**
- `npx.cmd tsc --noEmit` — typecheck
- `npm.cmd run build` — production build
- `npm.cmd run dev` — dev server
- `node --experimental-strip-types verify-crypto.ts` — crypto verification harness
- PowerShell blocks `npm.ps1`; use `npm.cmd` / `npx.cmd`.

**Known gotchas:**
- The Supabase service-role key bypasses RLS. It must never use a `NEXT_PUBLIC_`
  prefix and must never reach the browser.
- `verify-crypto.ts` imports with an explicit `.ts` extension so it can run
  directly under `node --experimental-strip-types`; `tsconfig.json` enables
  `allowImportingTsExtensions` for that reason.
- The encryption key lives in a React ref (not state, not persisted). Closing
  the tab discards it — there is no "remember me" by design.

## Standing rules (copied from agent-rules.md)

### Core workflow

- Create `AGENTS.md` in the repo root if it does not exist. Add `AGENTS.md` to
  `.gitignore` so it is never committed or pushed.
- Write the standing rules below into `AGENTS.md`, then add project specifics.
  Keep it current.
- If `README.md` is missing, create a short one: what the project is, how to
  install, run, test and deploy, env var names (never values), and current status.
- Before coding: explore the project structure, read the relevant files and
  existing patterns, then state your plan and list the files you expect to
  change. If the task is ambiguous or conflicts with the existing architecture,
  stop and ask one clear question.

### 1. Git workflow

- Never commit or push to `main`. `main` receives merges only.
- Work on a branch from an up-to-date `main`: `git switch -c <short-descriptive-name>`, then `git push -u origin <branch>`.
- Commit and push to your branch after every coherent change. One change, one
  commit, pushed, then move on. Do not batch unrelated work and do not leave
  work uncommitted.
- A commit is one coherent change that leaves the repo consistent, not one file
  and not one keystroke. Never commit a half-finished refactor. Two unrelated
  fixes means two commits. Refactoring beside a bug fix is a separate commit.
- Merging: when you believe the branch is ready, say so, with your reasoning,
  CI status, and a summary of the diff. Open the PR and wait. Merge only after
  the user explicitly confirms. Before asking, confirm CI is green and the diff
  matches your report.
- Reverting is a commit. History is append-only. If a pushed commit was wrong,
  add a commit that undoes it and say in the message what was wrong.
- Once the project is deployed and has even one user, remind the user to keep
  all work on branches and never test on main.

### 2. Gates before every commit

- Run typecheck, lint, and the test suite. A commit that fails them does not
  happen. Fix it, or explain in the commit message why the exception is
  correct. No `--no-verify` without a documented reason.
- If a gate does not exist, say so. Do not invent one or claim it passed.
- If a gate needs a backend or database that is down, say so in the commit
  message instead of implying it passed.
- Investigate the real cause of failures. Never hide, skip, or mute a failing
  test to get green.

### 3. README upkeep

- Update `README.md` at the end of a session, when a PR is opened or merged,
  and whenever setup, commands, env vars, or architecture change.
- It must reflect the latest state: what was added, removed or changed,
  current gate results, commands to run the project, open PRs, blocked items,
  and anything waiting on someone.
- Fold README changes into the relevant commit when source changes. Otherwise
  commit them separately.
- Never put secrets in the README.

### 4. Tech choices

- Use the best tool for the job, not the most familiar one. If React can do it
  but Go, Rust or C++ does it meaningfully better and delivers a better result,
  use the better one, and explain the trade-off in two lines.
- Replace vanilla JS with React and/or TypeScript, or whatever framework fits
  the project best. Use strict types everywhere.
- Prefer the frameworks and libraries the project already uses. Do not rewrite
  what a mature dependency already does well.
- Add a dependency only when it is genuinely necessary. Never add one for
  convenience.
- Auth is built in-house. No third-party auth providers. Use vetted libraries
  for cryptographic primitives (password hashing, signing, encryption) and
  never invent your own crypto.
- If a better approach than the one requested exists, flag it with trade-offs
  instead of silently changing direction.
- Keep code small and modular: small focused functions, well-named modules,
  split files that pass roughly 300 lines. Before pasting a large generated
  block, ask whether it can be smaller, split, or handled by a library.
- Automate everything that can be automated: tests, lint, builds, audits,
  scans, migration checks, and repeated manual steps; run them and report
  results. Never automate irreversible or outward-facing actions without my
  confirmation — merging, deploying, deleting data, force-pushing, spending
  money, sending messages. Those require explicit approval before they run.

### 5. UI and UX

- No taglines, filler helper text, or secondary labels. If a screen needs words
  to make sense, fix the layout instead.
- Make the decision that improves UX, developer experience, and agent
  experience together, without breaking anything.
- Handle loading, empty, error, and success states on every screen.
- Responsive by default. Must work on a cheap Android phone.
- Accessibility basics: contrast, focus states, labels for inputs, alt text on
  images.
- Keep functional text (error messages, field labels, accessibility labels).
  The cut is for decoration, not for clarity.

### 6. Security model (top tier, always on)

- Enforce authentication and authorization on the server for every route,
  resource, and object. Never trust the UI. Check ownership on every ID lookup.
- Validate and sanitize every input on the server, with strict schemas. Reject,
  do not coerce.
- Hash passwords with argon2id (or bcrypt if argon2id is unavailable).
  Short-lived sessions or tokens, httpOnly secure cookies, rotation on
  privilege change, real logout and revocation.
- Rate limit login, signup, OTP, password reset, and every expensive or
  sensitive endpoint. Lock out or slow down abusive patterns.
- Set security headers (CSP, HSTS, X-Content-Type-Options, frame protections),
  a strict CORS allowlist, and CSRF protection where cookies are used.
- Parameterized queries only. Least-privilege database users. Row-level rules
  so users only see their own data.
- Secrets live in environment variables or a secrets manager, never in the
  frontend or git. Keep `.env.example` with names only. Never log, copy, print,
  or send any key, token, phrase, or secret.
- Errors never leak stack traces, SQL, or internals. Log details server-side
  with a correlation ID, return a generic message.
- Use correct HTTP status codes. Never return `200 OK` with
  `{ "success": false, "error": "Unauthorized" }`. Use 400, 401, 403, 404, 409,
  422, 429, 500 as appropriate, with a consistent error body.
- Lock dependency versions, run dependency audits and secret scans, and avoid
  abandoned packages.
- Treat uploads as hostile: limit size and type, verify content, store outside
  the web root, never execute them.
- Where AI providers are used, set spending caps and per-user limits.
- Routes that are intentionally public (no accounts by design) must be
  documented as such in the README and protected with rate limits, input
  limits, and spending caps instead of auth; never add auth to them without
  asking.

### 7. Engineering depth checklist (test and verify when relevant)

Do not just list these. Check the ones the work touches and report what you
verified:

- **Database:** transactions, ACID, isolation levels, optimistic vs pessimistic
  locking, race conditions, deadlocks, connection pooling, N+1 queries, indexes,
  query optimization (EXPLAIN ANALYZE), foreign key and unique constraints,
  migrations including zero-downtime migrations, read replicas and replication
  lag, sharding, partitioning.
- **Caching:** invalidation, Redis eviction, cache stampedes, distributed
  caching.
- **Resilience:** idempotency, retries with exponential backoff and jitter,
  circuit breakers, rate limiting, backpressure, graceful shutdown, health
  checks.
- **Scale and infra:** load balancing, horizontal and vertical scaling, reverse
  proxies.
- **Async and events:** message queues, dead letter queues, background workers,
  job scheduling, event-driven design, eventual consistency, distributed
  transactions, outbox pattern, CQRS, event sourcing, webhook verification and
  retries.
- **Observability:** structured logs, error tracking, distributed tracing,
  alerts.
- **Usernames:** where a project needs fast username availability checks at
  scale, use a Bloom filter in front of the database lookup, with the database
  unique constraint remaining the source of truth.

### 8. Testing standard

- Tests are not just "1200/1200 passed". Test how a real person will use the
  product. Run UI and UX tests (end to end, browser automation) whenever possible.
- Write adversarial tests that try to break the work, not tests that confirm
  the happy path.
- Every bug fix needs a test, and the fix must be revert-verified: show that
  reverting the fix makes that test fail. This applies to fixes with testable
  logic. CSS, copy, and config changes are exempt.
- Report scenarios that prove nothing instead of hiding them. Report pass and
  fail counts.
- Only when you claim the work is 100% done, run the adversarial pass: actively
  try to break every assumption you made.

### 9. Money rules (any project that touches money)

Secure the money flow:

- Never use floating point for money. Use integer minor units or a proper decimal type.
- Use a proper ledger (append-only entries) for every movement of money. A single
  mutable balance field is never the source of truth.
- Every money-moving request is idempotent, so retries, double-clicks, and
  network issues cannot create duplicate transactions.
- Handle concurrency so two simultaneous withdrawals cannot spend the same money
  twice (row locks, serializable transactions, or equivalent).
- Verify webhook signatures. Handle duplicate, delayed, replayed, and
  out-of-order webhooks safely.
- Never trust the frontend to say a payment succeeded. Verify server-side with
  the payment provider.
- Enforce authorization server-side on every account, transaction, and resource.
- Keep an audit trail of important financial actions, without logging passwords,
  tokens, or sensitive payment data.
- Set sensible transaction limits and rate limits on login, OTP, transfers, and withdrawals.
- Add reconciliation so the ledger can be compared against the provider or bank
  and discrepancies are detected.
- Design so timeouts, crashes, and failed dependencies can never leave money in
  an unknown state.

Then try to break it. Write automated tests for each of these:

- Send the same transfer 10 times.
- Send 20 simultaneous withdrawals against the same balance.
- Send the same webhook repeatedly, with a fake signature, and out of order.
- Kill a worker halfway through processing.
- Simulate the provider timing out after taking the money.
- Simulate the database failing halfway through a transaction.
- Log in as User A and try to access User B's transactions.
- Try 0, negative values, absurdly large values, and malformed amounts.
- Retry requests after timeouts.
- Restart the application while a transaction is processing.
- Finally, reconcile the ledger against the provider and confirm every unit of
  money is exactly where it should be.

Before real money touches it:

- Run dependency, secret, static, and API security scans.
- Test everything in the provider's sandbox or staging environment.
- Set up monitoring and alerts for abnormal transactions.
- If handling card data or operating a real financial product, tell the user
  which PCI and regulatory requirements apply.

### 10. Pre-launch checklist

At the end of a project, before launch, work through this list and report each
item as done, not applicable, or needs the user.

**Secrets and access**

1. No API keys in the frontend or in git. Rotate any key that was ever committed.
2. HTTPS enforced.
3. Auth checked on every route, not just the UI.
4. Database rules so users see only their own data.
5. Every input validated on the server.
6. Rate limiting on, so one user cannot burn the bill. Spending cap on any AI provider.
7. Errors do not leak stack traces.

**Reliability**

8. Error tracking set up.
9. Database backed up, and a restore actually tested.
10. Rollback plan written for launch day.
11. Signup, payment, and password reset tested end to end.
12. Emails authenticated (SPF, DKIM, DMARC) and not landing in spam.

**Performance and quality**

13. Nothing takes more than 3 seconds to load. Page speed checked, images compressed.
14. Works on a cheap Android phone and is mobile responsive.
15. Custom 404 and 500 pages that do not look broken.
16. Form validation and spam protection.
17. Broken links fixed.
18. Color contrast and image alt text fixed.

**Launch surface**

19. Meta titles and descriptions, social preview (OG) image, favicon.
20. Sitemap and robots.txt.
21. Privacy policy and terms and conditions. Cookie consent banner where required.
22. Analytics set up to see where people drop off.
23. A single clear CTA.
24. A way for users to contact the owner.

### 11. Terrible user reminder

The app is not really tested until someone has been a terrible user. At the end
of a session, and before launch, remind the user to manually try:

- Double-clicking buttons.
- Refreshing during checkout.
- Submitting the same request twice.
- Changing IDs in URLs.
- Uploading ridiculous files.
- Turning the internet off halfway through.
- Opening the same account on two devices.

### 12. End-of-task review (make no mistakes)

Mistakes are not prevented by intent, they are caught by review. At the end of
every task, before reporting, re-read your own diff like a senior engineer who
did not write it and check:

- Does the diff do exactly what was asked, nothing more, nothing less?
- Type errors, runtime errors, broken imports, dead code, leftover debug logs.
- Security: auth on every touched route, input validation, no secrets, no leaked errors.
- Edge cases: empty, null, huge, malformed, concurrent, offline.
- Regressions: did anything that worked before stop working? Run the existing
  tests to find out.
- Duplication: did you reuse existing components and utilities?
- Responsiveness and loading, empty, error, and success states on every touched screen.
- Were the claims in your report verified by running something, not assumed?

Fix what you find, then report what you found and fixed. If you find nothing,
look once more.

### 13. Reporting standard

- Report every file changed with a one-line summary.
- Report gate results with pass and fail counts.
- Be honest about what was not verified. Push back on the user's reasoning when
  it is wrong, and verify claims instead of trusting them.
- If a change depends on an answer only the owner can give (provider choice,
  whether a screen ships, a route's contract), stop and ask one question. This
  is not a reason to commit something you know is provisional.
- Do not claim "done" until gates pass, adversarial tests have run, and the
  README is current.