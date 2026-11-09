import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { PeopleSecurity } from './people.contracts';

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
}
export class LocalPeopleSecurity implements PeopleSecurity {
  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    return `scrypt-32768-8-3-v1$${salt}$${(await derive(password, salt)).toString('hex')}`;
  }
  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const parts = stored.split('$');
    // Unknown accounts still perform the expensive derivation to reduce account-enumeration timing.
    const valid = parts[0] === 'scrypt-32768-8-3-v1' && /^[a-f0-9]{32}$/.test(parts[1] ?? '') && /^[a-f0-9]{64}$/.test(parts[2] ?? '');
    const key = await derive(password, valid ? parts[1]! : '00000000000000000000000000000000');
    const expected = valid ? Buffer.from(parts[2]!, 'hex') : Buffer.alloc(32);
    return timingSafeEqual(key, expected) && valid;
  }
  newSession(): { token: string; hash: string } {
    const token = randomBytes(32).toString('hex');
    return { token, hash: this.hashToken(token) };
  }
  hashToken(token: string): string { return this.hashText(token); }
  hashText(text: string): string { return createHash('sha256').update(text).digest('hex'); }
  hashBytes(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
}
