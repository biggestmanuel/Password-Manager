import 'server-only';

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * A plain `===` bails out on the first differing character, so an attacker
 * can recover a secret one byte at a time by measuring response latency.
 * `timingSafeEqual` runs in constant time instead. The length check is
 * kept outside it because Node's implementation throws on a length
 * mismatch, and the lengths here (a SHA-256 digest in fixed-width base64)
 * are not themselves secret.
 */
export function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// --- Validation schemas -------------------------------------------------
// Everything crossing the API boundary is validated here. These routes
// accept ciphertext from the client, and a malformed row that reached the
// database would be permanently undecryptable.

const base64Field = z.string().min(1).max(20_000);

export const kdfSchema = z.object({
  algorithm: z.literal('argon2id'),
  salt: base64Field,
  memoryKiB: z.number().int().min(8_192).max(1_048_576),
  iterations: z.number().int().min(1).max(100),
  parallelism: z.number().int().min(1).max(16),
});

export const setupSchema = z.object({
  verifierHash: base64Field,
  kdf: kdfSchema,
});

export const loginSchema = z.object({
  verifierHash: base64Field,
});

const encryptedFields = {
  payload: base64Field,
  iv: z.string().min(1).max(64),
  authTag: z.string().min(1).max(64),
};

export const createEntrySchema = z.object({
  id: z.string().uuid(),
  ...encryptedFields,
});

export const updateEntrySchema = z.object({
  ...encryptedFields,
  /**
   * The revision the edit was based on. If the stored row has moved past
   * this, someone (possibly another device) edited it in the meantime and
   * we reject rather than silently clobbering their change.
   */
  baseRevision: z.number().int().min(1),
});

/** Parse a JSON body, returning null instead of throwing on bad input. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** Validate and unwrap, or return an error response. */
export async function parseBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: NextResponse }> {
  const body = await readJson(request);
  const result = schema.safeParse(body);
  if (!result.success) {
    return { ok: false, response: jsonError('Invalid request body', 400) };
  }
  return { ok: true, data: result.data };
}