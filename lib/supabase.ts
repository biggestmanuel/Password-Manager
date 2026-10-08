import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side-only Supabase client using the service-role key.
 *
 * This is the crux of the security model. The service-role key bypasses
 * row-level security and can read and write everything, so it must stay on
 * the server. The `import 'server-only'` at the top makes any attempt to
 * pull this module into a client component fail the build rather than
 * silently bundling the key into public JavaScript.
 *
 * The previous version of this project shipped the *anon* key to the
 * browser and paired it with `using (true)` RLS policies, which meant
 * anyone could read and rewrite the entire vault straight through the
 * Supabase REST API, bypassing the app entirely.
 */

let client: SupabaseClient | undefined;

/**
 * Config is validated here rather than at module scope on purpose. A
 * module-level throw runs during `next build` while Next.js collects page
 * data, which would make the build fail for anyone who has not yet copied
 * `.env.example` to `.env.local` -- even though no real request was being
 * served. Failing at first use keeps the build environment-independent
 * while still failing loudly and specifically on a live request.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. See .env.example. ' +
        'The service-role key must NEVER use the NEXT_PUBLIC_ prefix, which would inline it ' +
        'into public JavaScript.',
    );
  }

  client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}