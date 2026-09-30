import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createHttpError } from "./http-error.js";

/**
 * Encryption for credentials businesses connect (payment gateway keys, WhatsApp/SMS tokens): AES-256-GCM with a
 * key from SECRETS_ENCRYPTION_KEY (MARKETING_ENCRYPTION_KEY is still accepted). In production nothing can be
 * encrypted without it. Changing the key makes stored credentials unreadable; they would have to be entered again.
 */
const DEV_KEY = "dev-only-secrets-key-set-SECRETS_ENCRYPTION_KEY-in-production";
export const configuredSecretsKey = () => String(process.env.SECRETS_ENCRYPTION_KEY || process.env.MARKETING_ENCRYPTION_KEY || "");

const encryptionKey = () => {
  const configured = configuredSecretsKey();
  if (configured.length >= 32) return createHash("sha256").update(configured).digest();
  if (process.env.NODE_ENV === "production") {
    throw createHttpError({ statusCode: 503, code: "SECRETS_KEY_MISSING", message: "Set SECRETS_ENCRYPTION_KEY (at least 32 characters) on the server before connecting accounts" });
  }
  return createHash("sha256").update(DEV_KEY).digest();
};

export const encryptSecret = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
};

export const decryptSecret = (value) => {
  if (!value) return null;
  const [version, iv, tag, data] = String(value).split(":");
  if (version !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
};
