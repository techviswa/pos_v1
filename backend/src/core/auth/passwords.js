import { pbkdf2, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";

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
    if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
      return false;
    }
    return stored === String(password || "");
  }

  const [, iterations, salt, hash] = stored.split("$");
  if (!iterations || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  if (!Number.isInteger(Number(iterations)) || Number(iterations) < 10000 || Number(iterations) > 1000000 || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const actual = pbkdf2Sync(String(password || ""), salt, Number(iterations), expected.length, DIGEST);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

// Asynchronous versions for request paths: PBKDF2 runs on Node's worker pool instead of blocking every other
// request (each check takes ~0.1 s of CPU; a burst of logins at shift change used to stall billing).
const pbkdf2Async = (password, salt, iterations, length) => new Promise((resolve, reject) => {
  pbkdf2(String(password || ""), salt, iterations, length, DIGEST, (error, key) => (error ? reject(error) : resolve(key)));
});

export const hashPasswordAsync = async (password) => {
  const salt = randomBytes(16).toString("hex");
  const hash = (await pbkdf2Async(password, salt, ITERATIONS, KEY_LENGTH)).toString("hex");
  return `${HASH_PREFIX}$${ITERATIONS}$${salt}$${hash}`;
};

// Checked when the account does not exist, so a missing account takes as long as a wrong password.
const DUMMY_HASH = `${HASH_PREFIX}$${ITERATIONS}$${"0".repeat(32)}$${"0".repeat(128)}`;

export const verifyPasswordAsync = async (password, storedValue) => {
  const stored = String(storedValue || DUMMY_HASH);
  if (!isPasswordHash(stored)) return verifyPassword(password, stored);
  const [, iterations, salt, hash] = stored.split("$");
  if (!iterations || !salt || !hash || !Number.isInteger(Number(iterations)) || Number(iterations) < 10000 || Number(iterations) > 1000000 || !/^[a-f0-9]{128}$/i.test(hash)) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = await pbkdf2Async(password, salt, Number(iterations), expected.length);
  return Boolean(storedValue) && expected.length === actual.length && timingSafeEqual(expected, actual);
};
