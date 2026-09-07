import prisma from "./client.js";

export const readState = async (key, fallback = null, client = prisma) =>
  (await client.stateDocument.findUnique({ where: { key } }))?.data ?? fallback;

export const writeState = async (key, data, client = prisma) => {
  const value = JSON.parse(JSON.stringify(data));
  const row = await client.stateDocument.upsert({
    where: { key }, create: { key, data: value }, update: { data: value },
  });
  return row.data;
};
