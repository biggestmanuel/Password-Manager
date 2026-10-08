import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { createSession } from '@/lib/session';
import { jsonError, parseBody, setupSchema } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * POST /api/auth/setup -> create the vault. One-time only.
 *
 * Note what this endpoint does NOT receive: the master password. The
 * browser derives the key, the login verifier, and the verifier hash
 * locally, then sends only `{ verifierHash, kdf }`. The server has no
 * value to hash because it never holds the password, and no way to derive
 * the key even if it wanted to.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, setupSchema);
  if (!parsed.ok) return parsed.response;
  const { verifierHash, kdf } = parsed.data;

  const supabase = getSupabase();

  const { data: existing } = await supabase
    .from('vault_meta')
    .select('id')
    .eq('id', 1)
    .maybeSingle();

  if (existing) {
    return jsonError('Vault is already set up', 409);
  }

  const { error } = await supabase.from('vault_meta').insert({
    id: 1,
    verifier_hash: verifierHash,
    kdf_algorithm: kdf.algorithm,
    kdf_salt: kdf.salt,
    kdf_memory_kib: kdf.memoryKiB,
    kdf_iterations: kdf.iterations,
    kdf_parallelism: kdf.parallelism,
  });

  if (error) {
    // A unique-violation here means two setup requests raced, and the
    // second one lost. The vault exists, which is all that matters.
    if (error.code === '23505') {
      return jsonError('Vault is already set up', 409);
    }
    return jsonError(error.message, 500);
  }

  await createSession();
  return NextResponse.json({ success: true });
}