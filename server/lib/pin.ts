import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_KEYLEN = 64;
const SCRYPT_COST = 16384; // N=2^14, recommended for interactive login

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  if (!salt || !hash) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, salt, SCRYPT_KEYLEN, { N: SCRYPT_COST, r: 8, p: 1 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
  const storedBuf = Buffer.from(hash, "hex");
  if (derived.length !== storedBuf.length) return false;
  return timingSafeEqual(derived, storedBuf);
}
