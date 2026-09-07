export const nextDocumentSequence = async (tx, key, initialValue = 0) => {
  const row = await tx.documentSequence.upsert({
    where: { key }, create: { key, value: initialValue + 1 }, update: { value: { increment: 1 } },
  });
  return row.value;
};
