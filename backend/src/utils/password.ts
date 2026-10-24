import { Algorithm, hash, verify } from '@node-rs/argon2';
import { config } from '../config/env';

/**
 * Password hashing with Argon2id. Parameters come from the environment so that
 * production can tune cost without code changes.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, {
    algorithm: Algorithm.Argon2id,
    memoryCost: config.auth.argon2.memoryCost,
    timeCost: config.auth.argon2.timeCost,
    parallelism: config.auth.argon2.parallelism,
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // A malformed hash must not authenticate anyone.
    return false;
  }
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * A valid Argon2id hash used to keep invalid-login timing close to a real
 * password check. Generated lazily and cached for the process lifetime.
 */
export function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('temponest-invalid-password-placeholder');
  return dummyHashPromise;
}
