import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

const HASH_PREFIX = "pbkdf2";
const ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = "sha512";

export const isPasswordHash = (value) => String(value || "").startsWith(`${HASH_PREFIX}$`);

export const hashPassword = (password) => {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(String(password || ""), salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("hex");
  return `${HASH_PREFIX}$${ITERATIONS}$${salt}$${hash}`;
};

export const verifyPassword = (password, storedValue) => {
  const stored = String(storedValue || "");

  if (!isPasswordHash(stored)) {
    return stored === String(password || "");
  }

  const [, iterations, salt, hash] = stored.split("$");
  if (!iterations || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = pbkdf2Sync(String(password || ""), salt, Number(iterations), expected.length, DIGEST);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

