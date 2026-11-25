import { buildReceiptHtml, feedbackUrlFor, toReceiptData } from "./printReceipt";

const bill = {
  id: "cmwwkk3wm001lfc3ob3swvnau",
  invoice_number: "CF-MAIN-20261125-0001",
  created_at: "2026-11-25T20:21:32.998Z",
  fulfillment_label: "Table T1",
  customer_name: "Vis <script>",
  customer_phone: "1234567890",
  items: [
    { name: "Cheesecake Slice", quantity: 1, price: 180 },
    { name: "Green Tea", quantity: 1, price: 70, addons: ["Honey"] },
  ],
  subtotal: 250,
  tax: 45,
  total: 295,
  gst_breakup: { gst_rate: 18, cgst: 22.5, sgst: 22.5, igst: 0 },
  payments: [{ method: "Cash", amount: 295, status: "confirmed" }, { method: "UPI", amount: 10, status: "failed" }],
  feedback_token: "fb_abc",
};
const settings = { shopName: "Bheemas Cafe", address: "MG Road", gst: "29ABCDE1234F1Z5", currency: "INR", footer: "Visit again" };

it("prints the invoice number, items, GST split and confirmed payments", () => {
  const html = buildReceiptHtml({ bill, settings });
  expect(html).toContain("CF-MAIN-20261125-0001");
  expect(html).not.toContain(bill.id);
  expect(html).toContain("TAX INVOICE");
  expect(html).toContain("CGST 9%");
  expect(html).toContain("SGST 9%");
  expect(html).toContain("Cheesecake Slice x1");
  expect(html).toContain("Honey");
  expect(html).toContain("Paid by Cash");
  expect(html).not.toContain("Paid by UPI");
  expect(html).toContain("Bheemas Cafe");
  expect(html).toContain("GSTIN 29ABCDE1234F1Z5");
});

it("escapes customer text so it cannot inject markup into the print frame", () => {
  const html = buildReceiptHtml({ bill, settings });
  expect(html).not.toContain("<script>");
  expect(html).toContain("Vis &lt;script&gt;");
});

it("marks offline receipts as provisional and never prints a feedback link for them", () => {
  const offline = { id: "OFFLINE-1234ABCD", offline: true, items: bill.items, subtotal: 250, tax: 45, total: 295, payment: "Cash", feedback_token: "fb_x" };
  const html = buildReceiptHtml({ bill: offline, settings });
  expect(html).toContain("PROVISIONAL RECEIPT");
  expect(html).toContain("OFFLINE-1234ABCD");
  expect(feedbackUrlFor(offline, "https://pos.example")).toBe("");
  expect(toReceiptData(offline).payments).toEqual([{ method: "Cash", amount: 295, pending: false }]);
});

it("builds the feedback link on the site the receipt is printed from", () => {
  expect(feedbackUrlFor(bill, "https://pos-v1-pi.vercel.app")).toBe("https://pos-v1-pi.vercel.app/feedback/fb_abc");
});
