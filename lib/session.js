import { unpackSessionCookie } from './crypto';

const COOKIE_NAME = 'vault_session';
const IDLE_TIMEOUT_SECONDS = 20 * 60; // 20 minutes

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = IDLE_TIMEOUT_SECONDS;

// Pulls the vault key out of the request's httpOnly cookie. Returns
// null if there's no session or it fails to decrypt (wrong/rotated
// SESSION_SECRET, tampered cookie, etc) — callers treat that as "not
// logged in," not as a crash.
export function getVaultKeyFromCookies(cookieStore) {
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;
  try {
    return unpackSessionCookie(cookie.value);
  } catch {
    return null;
  }
}
