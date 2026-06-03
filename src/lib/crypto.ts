// AES-GCM encrypt/decrypt for integration credentials.
// Uses Node's built-in crypto (no external deps).
//
// Key is INTEGRATIONS_ENCRYPTION_KEY env var — 32 bytes (256-bit) base64.
// Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
//
// Set the key in Vercel env (production) and .env.local (dev). DO NOT commit it.
// Losing this key means losing access to every stored credential — rotate
// integrations rather than the key, in normal operation.

import {createCipheriv, createDecipheriv, randomBytes} from 'crypto';

function getKey(): Buffer {
  const b64 = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!b64) {
    throw new Error(
      'INTEGRATIONS_ENCRYPTION_KEY not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export type EncryptedBlob = {
  ciphertext: Buffer;
  iv: Buffer;
};

export function encryptJson(payload: unknown): EncryptedBlob {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([ct, tag]),   // append tag so we don't need a 3rd column
    iv,
  };
}

export function decryptJson<T = unknown>(blob: EncryptedBlob): T {
  const key = getKey();
  const tag = blob.ciphertext.subarray(blob.ciphertext.length - 16);
  const ct = blob.ciphertext.subarray(0, blob.ciphertext.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, blob.iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
