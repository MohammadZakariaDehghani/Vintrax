import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for secrets an administrator saves through the app
 * (D-069) — a provider API key, for instance — where the environment file is
 * not something the app can write.
 *
 * AES-256-GCM: a fresh 96-bit IV per seal, and the authentication tag stored
 * with the ciphertext, so a modified ciphertext fails to open rather than
 * decrypting to something else. `aad` binds the ciphertext to what it is for
 * ("email-settings:resend:api-key"): copied into another column, it does not
 * open.
 *
 * The key is SETTINGS_ENCRYPTION_KEY from the server environment, never the
 * database or the repository. `keyId` is a short fingerprint of it, stored
 * beside the ciphertext so a missing or rotated key is reported as such
 * instead of as a corrupt value.
 */

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
  keyId: string;
}

export class SecretBox {
  private readonly key: Buffer;
  readonly keyId: string;

  constructor(base64Key: string) {
    const key = Buffer.from(base64Key, 'base64');
    if (key.length !== 32) {
      throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    }
    this.key = key;
    this.keyId = createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  seal(plaintext: string, aad: string): SealedSecret {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      keyId: this.keyId,
    };
  }

  /** Throws if the key, the AAD, the IV, the tag or the ciphertext is not the one sealed. */
  open(sealed: Omit<SealedSecret, 'keyId'>, aad: string): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
