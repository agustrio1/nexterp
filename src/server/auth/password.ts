import { hash, verify, type Options } from "@node-rs/argon2";

/**
 * Argon2id dengan parameter minimum rekomendasi OWASP: memori 19 MiB, 2 iterasi, 1 thread.
 * Parameter tersimpan di dalam hash, jadi bisa dinaikkan kelak tanpa merusak hash lama.
 */
const argon2Options: Options = {
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

export function hashPassword(password: string): Promise<string> {
  return hash(password, argon2Options);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    // Hash rusak atau format tidak dikenal dianggap tidak cocok.
    return false;
  }
}