import prisma from "../../database/prisma/client.js";
import { normalizeBillingMetadata } from "./billing-metadata.utils.js";

class BillingMetadataRepository {
  async get(invoiceId, { tx = prisma } = {}) {
    const bill = await tx.bill.findUnique({
      where: { id: invoiceId },
      select: { metadata: true },
    });
    return normalizeBillingMetadata(bill?.metadata || {});
  }

  async set(invoiceId, payload = {}, { tx = prisma } = {}) {
    const metadata = normalizeBillingMetadata(payload);
    await tx.bill.update({
      where: { id: invoiceId },
      data: { metadata },
    });
    return metadata;
  }

  async merge(invoiceId, payload = {}, { tx = prisma } = {}) {
    const current = await this.get(invoiceId, { tx });
    const next = normalizeBillingMetadata(payload, { base: current });
    await tx.bill.update({
      where: { id: invoiceId },
      data: { metadata: next },
    });
    return next;
  }

  async delete(invoiceId, { tx = prisma } = {}) {
    await tx.bill.update({
      where: { id: invoiceId },
      data: { metadata: null },
    });
    return {};
  }
}

export const billingMetadataRepository = new BillingMetadataRepository();
