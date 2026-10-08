import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createSession } from '@/lib/session';
import { jsonError, parseBody, loginSchema, secretsMatch } from '@/lib/api';
import { clearFailedAttempts, getClientId, isRateLimited, recordFailedAttempt } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * POST /api/auth/login -> start a session.
 *
 * The client sends a verifier hash derived from its key. The server
 * compares it against the stored one in constant time. It cannot verify a
 * password (it never receives one) but that is not needed: matching
 * verifier hashes prove the caller can derive the same key, which is
 * exactly the capability required to decrypt the vault.
 */
export async function POST(request: Request) {
  const clientId = getClientId(request);

  if (await isRateLimited(clientId)) {
    return jsonError('Too many attempts. Try again in 15 minutes.', 429);
  }

  const parsed = await parseBody(request, loginSchema);
  if (!parsed.ok) return parsed.response;
  const { verifierHash } = parsed.data;

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('vault_meta')
    .select('verifier_hash')
    .eq('id', 1)
    .maybeSingle();

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Vault has not been set up yet', 404);

  // Always spend the same amount of time on the comparison so that a
  // missing vault row and a wrong verifier are indistinguishable.
  if (!secretsMatch(verifierHash, data.verifier_hash as string)) {
    await recordFailedAttempt(clientId);
    return jsonError('Incorrect master password', 401);
  }

  await clearFailedAttempts(clientId);
  await createSession();
  return NextResponse.json({ success: true });
}