import 'server-only';

import { getSupabase } from './supabase';

/** Attempts allowed per client within the window. */
const MAX_ATTEMPTS = 10;
const WINDOW_MINUTES = 15;

/**
 * Identify the caller for rate-limiting purposes.
 *
 * Uses the first entry of x-forwarded-for when present (the address the
 * edge proxy saw), falling back to x-real-ip.
 *
 * This is best-effort: a determined attacker controlling their own
 * forwarding header can trivially get a fresh quota per guess. It stops
 * casual and automated spray attacks, which is the realistic threat for a
 * single-user vault. Stronger protection means per-account throttling at
 * the edge or a hardware-key requirement, not header parsing.
 */
export function getClientId(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function isRateLimited(clientId: string): Promise<boolean> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from('vault_login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('failed_at', since);

  if (error) {
    // Fail closed on the limiter being unavailable: returning "not
    // limited" here would silently disable rate limiting during a
    // database blip.
    return true;
  }

  return (count ?? 0) >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(clientId: string): Promise<void> {
  await getSupabase().from('vault_login_attempts').insert({ client_id: clientId });
}

/** Clear the failure history after a successful unlock. */
export async function clearFailedAttempts(clientId: string): Promise<void> {
  await getSupabase().from('vault_login_attempts').delete().eq('client_id', clientId);
}