import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { requireSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/status -> tells the frontend which screen to show.
 *
 * `kdf` is returned to the browser because the client needs it to
 * reproduce the encryption key. A salt and its cost parameters are not
 * secrets -- publishing them does not weaken the key, and storing them is
 * what allows a second device to derive the same key at all.
 */
export async function GET() {
  const { data } = await getSupabase()
    .from('vault_meta')
    .select('kdf_algorithm, kdf_salt, kdf_memory_kib, kdf_iterations, kdf_parallelism')
    .eq('id', 1)
    .maybeSingle();

  const session = await requireSession();

  return NextResponse.json({
    vaultExists: !!data,
    authenticated: !!session,
    kdf: data
      ? {
          algorithm: data.kdf_algorithm as string,
          salt: data.kdf_salt as string,
          memoryKiB: data.kdf_memory_kib as number,
          iterations: data.kdf_iterations as number,
          parallelism: data.kdf_parallelism as number,
        }
      : null,
  });
}