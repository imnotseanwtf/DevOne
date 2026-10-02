import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32)
    throw new Error('DEVONE_ENCRYPTION_KEY must be 32 bytes encoded as base64');
  return key;
}

export function encryptSecret(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url')
  ].join('.');
}

export function decryptSecret(value: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes');

  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = value.split('.');
  if (version !== 'v1' || !encodedIv || !encodedTag || !encodedCiphertext || extra) {
    throw new Error('Invalid encrypted secret');
  }

  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(encodedIv, 'base64url'));
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final()
  ]).toString('utf8');
}

export function getEncryptionKey(): Buffer {
  const value = process.env.DEVONE_ENCRYPTION_KEY;
  if (!value) throw new Error('DEVONE_ENCRYPTION_KEY is required');
  return parseEncryptionKey(value);
}
