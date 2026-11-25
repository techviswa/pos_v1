import QRCode from "qrcode";
import { formatCurrency } from "../../../lib/pos";

// One receipt layout for every place that prints a bill (checkout and bill history), sized for 80 mm thermal
// paper but readable on A4. It prints from a hidden frame so the app's own layout never ends up on paper.

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const amount = (value) => Number(value || 0);

const formatDateTime = (value) => {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return `${date.toLocaleDateString("en-IN")} ${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
};

const itemOptions = (item) => [
  item.variation_name || (typeof item.variation === "string" ? item.variation : item.variation?.name),
  ...(Array.isArray(item.addons) ? item.addons.map((addon) => addon?.name || addon) : []),
  ...(Array.isArray(item.removals) ? item.removals.map((removal) => `No ${removal?.name || removal}`) : []),
  item.custom_note || item.customNote,
].filter((option) => typeof option === "string" && option.trim());

/** Turns a bill (API record or checkout receipt) into the plain fields a receipt prints. */
export const toReceiptData = (bill = {}) => {
  const payments = (Array.isArray(bill.payments) ? bill.payments : []).filter((payment) => payment && !["failed", "cancelled"].includes(payment.status));
  const gst = bill.gst_breakup || null;
  return {
    number: bill.offline ? bill.id : bill.invoice_number || bill.invoiceNumber || bill.id,
    provisional: Boolean(bill.offline),
    issuedAt: bill.created_at || bill.createdAt || null,
    service: [bill.fulfillment_label || bill.orderMeta?.fulfillment_label || bill.order_type, bill.token_number ? `Token ${bill.token_number}` : ""].filter(Boolean).join(" · "),
    customer: [bill.customer_name || bill.orderMeta?.customer_name, bill.customer_phone || bill.orderMeta?.customer_phone].filter((part) => part && part !== "Walk-in" && part !== "Walk-in Customer").join(" · "),
    notes: bill.notes || bill.orderMeta?.notes || "",
    items: (Array.isArray(bill.items) ? bill.items : []).map((item) => ({
      name: item.name || "Item",
      quantity: amount(item.quantity) || 1,
      unitPrice: amount(item.price),
      total: amount(item.line_total ?? item.total ?? amount(item.price) * (amount(item.quantity) || 1)),
      options: itemOptions(item),
    })),
    subtotal: amount(bill.subtotal),
    discountLabel: bill.discount_label || bill.discountLabel || "Discount",
    discount: amount(bill.discount_amount ?? bill.discountAmount),
    loyaltyDiscount: amount(bill.loyalty_discount ?? bill.loyaltyDiscount),
    serviceCharge: amount(bill.service_charge),
    gst: gst ? { rate: amount(gst.gst_rate), cgst: amount(gst.cgst), sgst: amount(gst.sgst), igst: amount(gst.igst) } : null,
    tax: amount(bill.tax),
    tip: amount(bill.tip_amount ?? bill.tipAmount),
    total: amount(bill.total),
    payments: payments.length
      ? payments.map((payment) => ({ method: payment.method || "Payment", amount: amount(payment.amount), pending: payment.status && payment.status !== "confirmed" }))
      : bill.payment_type || bill.payment ? [{ method: bill.payment_type || bill.payment, amount: amount(bill.total), pending: false }] : [],
    due: amount(bill.due_amount),
    offerTitle: bill.printable_offer_title || bill.printableOfferTitle || "",
    offerMessage: bill.printable_offer_message || bill.printableOfferMessage || "",
    feedbackToken: bill.offline ? "" : bill.feedback_token || "",
  };
};

/** The receipt as a complete HTML document. `feedbackQr` is an optional data: URL made on this device. */
export const buildReceiptHtml = ({ bill, settings = {}, feedbackQr = "" }) => {
  const data = toReceiptData(bill);
  const currency = settings.currency;
  const money = (value) => escapeHtml(formatCurrency(value, currency));
  const row = (label, value, className = "") => `<div class="row ${className}"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
  const shopLines = [settings.address, settings.phone ? `Phone ${settings.phone}` : "", settings.gst ? `GSTIN ${settings.gst}` : ""].filter(Boolean);
  const gstRows = data.gst && data.tax > 0
    ? data.gst.igst > 0
      ? row(`IGST ${data.gst.rate}%`, money(data.gst.igst))
      : `${row(`CGST ${data.gst.rate / 2}%`, money(data.gst.cgst))}${row(`SGST ${data.gst.rate / 2}%`, money(data.gst.sgst))}`
    : data.tax > 0 ? row("Tax", money(data.tax)) : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(data.number)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 12px/1.35 "Courier New", ui-monospace, monospace; color: #000; background: #fff; }
  .receipt { width: 72mm; margin: 0 auto; }
  .center { text-align: center; }
  .shop { font-size: 16px; font-weight: 700; }
  .muted { font-size: 11px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row span:last-child { text-align: right; white-space: nowrap; }
  .item { margin: 3px 0; }
  .options { font-size: 11px; padding-left: 8px; }
  .total { font-size: 15px; font-weight: 700; border-top: 1px dashed #000; margin-top: 4px; padding-top: 4px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  .note { border: 1px dashed #000; padding: 4px; margin: 6px 0; font-size: 11px; }
  img.qr { width: 32mm; height: 32mm; display: block; margin: 4px auto; }
</style></head><body><div class="receipt">
  <div class="center shop">${escapeHtml(settings.shopName || "Receipt")}</div>
  ${shopLines.map((line) => `<div class="center muted">${escapeHtml(line)}</div>`).join("")}
  <hr>
  <div class="center"><b>${data.provisional ? "PROVISIONAL RECEIPT" : data.gst ? "TAX INVOICE" : "RECEIPT"}</b></div>
  ${row(data.provisional ? "Ref" : "Invoice", `<b>${escapeHtml(data.number)}</b>`)}
  ${row("Date", escapeHtml(formatDateTime(data.issuedAt)))}
  ${data.service ? row("Order", escapeHtml(data.service)) : ""}
  ${data.customer ? row("Customer", escapeHtml(data.customer)) : ""}
  ${data.provisional ? `<div class="note">Taken offline. The tax invoice number is issued when this bill syncs.</div>` : ""}
  <hr>
  ${data.items.map((item) => `<div class="item">${row(`${item.name} x${item.quantity}`, money(item.total))}${item.options.length ? `<div class="options">${escapeHtml(item.options.join(", "))}</div>` : ""}</div>`).join("")}
  ${data.notes ? `<div class="options">Note: ${escapeHtml(data.notes)}</div>` : ""}
  <hr>
  ${row("Subtotal", money(data.subtotal))}
  ${data.discount > 0 ? row(data.discountLabel, `-${money(data.discount)}`) : ""}
  ${data.loyaltyDiscount > 0 ? row("Loyalty points", `-${money(data.loyaltyDiscount)}`) : ""}
  ${data.serviceCharge > 0 ? row("Service charge", money(data.serviceCharge)) : ""}
  ${gstRows}
  ${data.tip > 0 ? row("Tip", money(data.tip)) : ""}
  ${row("TOTAL", money(data.total), "total")}
  ${data.payments.map((payment) => row(`Paid by ${payment.method}${payment.pending ? " (pending)" : ""}`, money(payment.amount))).join("")}
  ${data.due > 0 ? row("Balance due", money(data.due)) : ""}
  ${data.offerTitle || data.offerMessage ? `<hr><div class="center"><b>${escapeHtml(data.offerTitle)}</b></div><div class="center muted">${escapeHtml(data.offerMessage)}</div>` : ""}
  ${feedbackQr ? `<hr><div class="center muted">Scan to rate your visit</div><img class="qr" alt="" src="${escapeHtml(feedbackQr)}">` : ""}
  ${settings.footer ? `<hr><div class="center muted">${escapeHtml(settings.footer)}</div>` : ""}
  <div class="center muted">Thank you!</div>
</div></body></html>`;
};

export const feedbackUrlFor = (bill, origin = window.location.origin) => {
  const token = toReceiptData(bill).feedbackToken;
  return token ? `${origin}/feedback/${token}` : "";
};

/** Prints the bill on the device's chosen printer. Resolves once the print dialog has been opened. */
export const printReceipt = async ({ bill, settings }) => {
  const feedbackUrl = feedbackUrlFor(bill);
  const feedbackQr = feedbackUrl ? await QRCode.toDataURL(feedbackUrl, { width: 240, margin: 1, errorCorrectionLevel: "M" }).catch(() => "") : "";
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open();
  doc.write(buildReceiptHtml({ bill, settings, feedbackQr }));
  doc.close();
  await Promise.all([...doc.images].map((image) => (image.complete ? null : new Promise((resolve) => { image.onload = image.onerror = resolve; }))));
  const view = frame.contentWindow;
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  view.addEventListener("afterprint", cleanup, { once: true });
  view.focus();
  view.print();
  // Some browsers never fire afterprint for frames; remove the frame after a minute regardless.
  setTimeout(() => frame.isConnected && frame.remove(), 60000);
};
