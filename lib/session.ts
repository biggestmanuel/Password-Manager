import 'server-only';

import { cookies } from 'next/headers';
import { getSupabase } from './supabase';

const COOKIE_NAME = 'vault_session';

/**
 * Rolling idle timeout.
 *
 * Unlike a fixed expiry, this is pushed forward on each authenticated
 * request, so an actively used vault stays open while an abandoned one
 * closes on its own.
 */
export const IDLE_TIMEOUT_SECONDS = 20 * 60;
const ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60;

/** Row shape from vault_sessions. */
type SessionRow = {
  id: string;
  created_at: string;
  expires_at: string;
};

function generateSessionId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a session and set it as an httpOnly cookie.
 *
 * Note what is NOT in the cookie: the encryption key. In a zero-knowledge
 * design the key never leaves the browser, so this cookie is only a
 * "this browser is logged in" flag. It carries no capability to decrypt
 * anything -- it cannot be used against a stolen database either.
 */
export async function createSession(): Promise<void> {
  const id = generateSessionId();
  const supabase = getSupabase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + IDLE_TIMEOUT_SECONDS * 1000);

  const { error } = await supabase
    .from('vault_sessions')
    .insert({ id, expires_at: expiresAt.toISOString(), last_seen_at: now.toISOString() });
  if (error) throw new Error(`Could not start session: ${error.message}`);

  const store = await cookies();
  store.set(COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: 'strict',
    // Secure cookies are dropped by browsers on plain http://localhost,
    // which would break local development, so this is gated on the
    // environment.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: IDLE_TIMEOUT_SECONDS,
  });
}

/**
 * Validate the session cookie and slide the timeout forward.
 * Returns null when there is no valid session.
 */
export async function requireSession(): Promise<SessionRow | null> {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (!id) return null;

  const supabase = getSupabase();
  const { data } = await supabase
    .from('vault_sessions')
    .select('id, created_at, expires_at')
    .eq('id', id)
    .maybeSingle();

  if (!data) return null;

  const session = data as SessionRow;
  const now = Date.now();
  const expiresAt = new Date(session.expires_at).getTime();
  const createdAt = new Date(session.created_at).getTime();

  if (expiresAt <= now) {
    await destroySession();
    return null;
  }

  // Enforce an absolute lifetime as well, so a session cannot be kept
  // alive forever by a periodic automated request.
  if (now - createdAt > ABSOLUTE_TIMEOUT_SECONDS * 1000) {
    await destroySession();
    return null;
  }

  await supabase
    .from('vault_sessions')
    .update({ last_seen_at: new Date(now).toISOString(), expires_at: new Date(now + IDLE_TIMEOUT_SECONDS * 1000).toISOString() })
    .eq('id', id);

  return session;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = store.get(COOKIE_NAME)?.value;
  if (id) {
    await getSupabase().from('vault_sessions').delete().eq('id', id);
  }
  store.delete(COOKIE_NAME);
}