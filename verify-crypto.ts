/**
 * Standalone verification of the crypto layer. Run with:
 *   node --experimental-strip-types verify-crypto.ts
 *
 * Not part of the app build -- a scratch harness to prove the primitives
 * behave correctly before trusting them with real data.
 */
import {
  createVaultKeys,
  unlockVault,
  hashVerifier,
  encryptEntry,
  decryptEntry,
  generatePassword,
  estimateStrength,
} from './lib/vault-crypto.ts';

let failures = 0;

function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function main() {
  console.log('\nkey derivation');
  const password = 'correct horse battery staple';
  const vault = await createVaultKeys(password);
  const reopened = await unlockVault(password, vault.kdfParams);

  check('same password derives the same verifier', reopened.verifier === vault.verifier);
  check('salt is 16 bytes', Buffer.from(vault.kdfParams.salt, 'base64').length === 16);

  const wrong = await unlockVault('wrong horse battery staple', vault.kdfParams);
  check('different password derives a different verifier', wrong.verifier !== vault.verifier);

  const hashA = await hashVerifier(vault.verifier);
  const hashB = await hashVerifier(vault.verifier);
  check('verifier hash is deterministic', hashA === hashB);
  check(
    'verifier hash is not the verifier itself',
    hashA !== vault.verifier,
  );
  check('hash is 32 bytes', Buffer.from(hashA, 'base64').length === 32);

  console.log('\nencryption round trip');
  const id = crypto.randomUUID();
  const data = { site: 'github.com', username: 'me@example.com', password: 'p@ss w0rd!', notes: 'line1\nline2 "quoted"' };

  const sealed = await encryptEntry(id, data, vault.encryptionKey);
  check('ciphertext does not contain the site name', !sealed.payload.includes('github'));
  check('ciphertext does not contain the password', !sealed.payload.includes('p@ss'));
  check('iv is 12 bytes', Buffer.from(sealed.iv, 'base64').length === 12);
  check('auth tag is 16 bytes', Buffer.from(sealed.authTag, 'base64').length === 16);

  const openedEntry = await decryptEntry(id, sealed, vault.encryptionKey);
  check('round trip preserves site', openedEntry.site === data.site);
  check('round trip preserves password', openedEntry.password === data.password);
  check('round trip preserves unicode/newlines', openedEntry.notes === data.notes);

  const sealed2 = await encryptEntry(id, data, vault.encryptionKey);
  check('a fresh IV is used per encryption', sealed2.iv !== sealed.iv);
  check('identical plaintext yields different ciphertext', sealed2.payload !== sealed.payload);

  console.log('\ntamper detection');
  let threw = false;
  try {
    await decryptEntry(id, sealed, wrong.encryptionKey);
  } catch {
    threw = true;
  }
  check('wrong key fails to decrypt', threw);

  threw = false;
  try {
    await decryptEntry(crypto.randomUUID(), sealed, vault.encryptionKey);
  } catch {
    threw = true;
  }
  check('AAD binding rejects the ciphertext under a different id', threw);

  threw = false;
  try {
    const flipped = Buffer.from(sealed.payload, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    await decryptEntry(id, { ...sealed, payload: flipped.toString('base64') }, vault.encryptionKey);
  } catch {
    threw = true;
  }
  check('flipped ciphertext bit fails to decrypt', threw);

  console.log('\npassword generator');
  const options = { length: 24, lower: true, upper: true, digits: true, symbols: true };
  const seen = new Set<string>();
  let charPoolOk = true;
  let lengthOk = true;
  let hasEachSet = true;

  for (let i = 0; i < 400; i += 1) {
    const pw = generatePassword(options);
    seen.add(pw);
    if (pw.length !== 24) lengthOk = false;
    // Unanchored: the generator shuffles, so a given class can appear at
    // any position. What is guaranteed is *at least one* of each.
    if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
      hasEachSet = false;
    }
    for (const ch of pw) {
      if (!/[a-zA-Z0-9!@#$%^&*()\-_=+[\]{};:,.?/]/.test(ch)) charPoolOk = false;
    }
  }

  check('all generated passwords are unique', seen.size === 400, `got ${seen.size}/400`);
  check('respects requested length', lengthOk);
  check('only emits characters from the selected pools', charPoolOk);
  check('includes at least one of each selected set', hasEachSet);

  const digitsOnly = generatePassword({ length: 10, lower: false, upper: false, digits: true, symbols: false });
  check('honours a restricted charset', /^[0-9]+$/.test(digitsOnly) && digitsOnly.length === 10);

  let threwOnEmpty = false;
  try {
    generatePassword({ length: 10, lower: false, upper: false, digits: false, symbols: false });
  } catch {
    threwOnEmpty = true;
  }
  check('rejects an empty charset', threwOnEmpty);

  console.log('\nstrength estimate');
  check('short password scores low', estimateStrength('abc').score <= 1);
  check(
    'long mixed password scores high',
    estimateStrength('Xk9$mQ2#vLp8@wRt4!zYc6').score === 4,
  );

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();