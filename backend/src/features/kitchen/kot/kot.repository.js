import { billingService } from "../../../core/billing/billing.service.js";
import { billingMetadataRepository } from "../../../core/billing/billing-metadata.repository.js";
import {
  toLegacyBillRecord,
  toLegacyKitchenTicketRecord,
} from "../../../core/billing/billing-legacy.serializer.js";

class KotRepository {
  async listTickets({ tenantId, limit }) {
    const bills = await billingService.listInvoices({ tenantId, limit });
    return bills.map((bill) => toLegacyKitchenTicketRecord(toLegacyBillRecord(bill)));
  }

  async updateTicketStatus({ tenantId, ticketId, kitchenStatus }) {
    const bill = await billingService.updateInvoice({
      tenantId,
      invoiceId: ticketId,
      payload: {
        kitchen_status: kitchenStatus,
      },
    });

    const metadata = await billingMetadataRepository.get(ticketId);

    return toLegacyKitchenTicketRecord(toLegacyBillRecord(bill, metadata));
  }
}

export const kotRepository = new KotRepository();
