import { createHash } from "node:crypto";
import prisma from "../../database/prisma/client.js";
import { createHttpError } from "./http-error.js";

// Confirm an already committed command without repeating a write after its
// initiating administrator loses access. The original payload must still match.
export async function readOperationalReceipt({ businessId, kind, payload }) {
  const requestId = payload.request_id;
  if (!requestId) return null;
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw createHttpError({ statusCode: 400, message: 'Invalid request identifier' });
  const saved = await prisma.stateDocument.findUnique({ where: { key: `operational-request:${businessId}:${kind}:${requestId}` } });
  if (!saved) return null;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  if (saved.data.business_id !== businessId || saved.data.fingerprint !== fingerprint) throw createHttpError({ statusCode: 409, message: 'This command was already submitted with different details' });
  return saved.data.result;
}

// A retry shares one transaction and one durable result with the original write.
export const operationalWrite = ({ businessId, kind, payload }, work) => prisma.$transaction(async (tx) => {
  const requestId = payload.request_id;
  if (!requestId) return work(tx);
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)) throw createHttpError({ statusCode: 400, message: "Invalid request identifier" });
  const key = `operational-request:${businessId}:${kind}:${requestId}`;
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])])) : value;
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  const saved = await tx.stateDocument.findUnique({ where: { key } });
  if (saved) {
    if (saved.data.fingerprint !== fingerprint) throw createHttpError({ statusCode: 409, message: "This request was already submitted with different details. Start a new request." });
    return saved.data.result;
  }
  const result = await work(tx);
  await tx.stateDocument.create({ data: { key, data: { business_id: businessId, fingerprint, result: JSON.parse(JSON.stringify(result)), created_at: new Date().toISOString() } } });
  return result;
});
