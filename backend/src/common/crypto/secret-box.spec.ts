import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

/**
 * Encryption at rest for secrets saved through the admin (D-069). Pinned: a
 * sealed value opens only with the same key and the same purpose; any change
 * to it fails rather than decrypting to something else; and nothing stored
 * beside it reveals the plaintext or the key.
 */

const key = () => randomBytes(32).toString('base64');
const SECRET = 're_live_0123456789abcdefghijklmnop';
const AAD = 'email-settings:resend:api-key';

describe('SecretBox', () => {
  it('opens what it sealed', () => {
    const box = new SecretBox(key());
    expect(box.open(box.seal(SECRET, AAD), AAD)).toBe(SECRET);
  });

  it('uses a fresh IV every time, so the same key never gives the same ciphertext', () => {
    const box = new SecretBox(key());
    const a = box.seal(SECRET, AAD);
    const b = box.seal(SECRET, AAD);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('stores nothing that contains the secret or the key', () => {
    const raw = key();
    const sealed = new SecretBox(raw).seal(SECRET, AAD);
    const stored = JSON.stringify(sealed);
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain('re_live');
    expect(stored).not.toContain(raw);
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain('re_');
  });

  it('will not open under another key', () => {
    const sealed = new SecretBox(key()).seal(SECRET, AAD);
    expect(() => new SecretBox(key()).open(sealed, AAD)).toThrow();
  });

  it('will not open for another purpose', () => {
    const box = new SecretBox(key());
    expect(() => box.open(box.seal(SECRET, AAD), 'something-else')).toThrow();
  });

  it('refuses a ciphertext, tag or IV that was changed', () => {
    const box = new SecretBox(key());
    const sealed = box.seal(SECRET, AAD);
    const flip = (b64: string) => {
      const bytes = Buffer.from(b64, 'base64');
      bytes[0] = (bytes[0] ?? 0) ^ 1;
      return bytes.toString('base64');
    };
    expect(() => box.open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, AAD)).toThrow();
    expect(() => box.open({ ...sealed, tag: flip(sealed.tag) }, AAD)).toThrow();
    expect(() => box.open({ ...sealed, iv: flip(sealed.iv) }, AAD)).toThrow();
  });

  it('identifies its key by a short fingerprint, stable and not the key', () => {
    const raw = key();
    const one = new SecretBox(raw);
    expect(one.keyId).toMatch(/^[0-9a-f]{16}$/);
    expect(new SecretBox(raw).keyId).toBe(one.keyId);
    expect(new SecretBox(key()).keyId).not.toBe(one.keyId);
    expect(raw).not.toContain(one.keyId);
  });

  it('refuses a key that is not 32 bytes', () => {
    expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
    expect(() => new SecretBox('not-base64-at-all')).toThrow();
  });
});
