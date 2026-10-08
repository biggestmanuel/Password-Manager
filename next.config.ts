import type { NextConfig } from 'next';

/**
 * Content Security Policy.
 *
 * A password manager holds a decryption key in memory, so the blast radius
 * of an XSS bug is total rather than partial. CSP is the second layer of
 * defence behind React's escaping.
 *
 * The important entries:
 *   object-src / base-uri / frame-ancestors 'none' -- block plugin
 *     content, `<base>` tag hijacking, and clickjacking.
 *   script-src without `unsafe-eval` except for WebAssembly, which
 *     hash-wasm (Argon2id) legitimately needs.
 *   connect-src pinned to the app origin plus Supabase. An exfiltration
 *     attempt to an attacker's domain is blocked by the browser even if
 *     script manages to run.
 */
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is required by Next.js for its own bootstrap and
  // inline flight-data payloads. It is the weakest link here; a
  // nonce-based policy would remove it at the cost of middleware.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  // API calls go to our own origin; Supabase is contacted server-side
  // only, so nothing in the browser needs to reach it.
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Do not let a proxy or the browser cache retain decrypted responses.
  { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;