QR checkout, split payments and loyalty

Combined table rounds and separate item invoices are now available from the QR bill-request inbox. See [QR_VISIT_BILLING_ALLERGENS.md](QR_VISIT_BILLING_ALLERGENS.md) for the updated workflow and limits.

Guest flow

1. Open a submitted QR order's tracking page. “Your bill & payment” shows whether the restaurant has issued the final invoice.
2. Request the final bill. To request loyalty redemption, send a verification code to the phone already recorded on the order, verify it, choose points and update the bill request. No phone number or balance is disclosed by the bill snapshot.
3. Staff with the billing permission use “QR final bill requests” on Manager or Billing to issue an unpaid invoice. The normal bill service validates prices, tax, shifts, stock and loyalty. If the balance changed, staff can explicitly issue without points; the guest sees the resulting invoice.
4. The guest reviews the invoice's tax, discounts, tip, total, confirmed payments and remaining balance. With Razorpay enabled, pay the full remainder or choose a share/custom amount. Suggested equal shares preserve every paise. These are partial payments against one invoice, not separate tax invoices.
5. Only one online payment link per invoice may be pending at a time. Pay that share, then use the next share. A signed gateway webhook or “Check payment status” confirms the captured payment; merely opening a link or entering a reference does not confirm money. Guests can cancel their QR-created request. Cashier-created requests must be handled by staff.

Scope and limits

- Checkout is authorized by the order's unguessable tracking capability. It exposes only that order's invoice; it does not combine or expose other guests' orders at the table. Further rounds retain their own invoices.
- Loyalty balances/redemption require a verified OTP for the exact order phone and business. Points are rechecked and debited at invoice issue; requests do not reserve points. Existing ledger logic earns points only when fully paid and reconciles refunds/voids.
- Bill issuance and staff queues use billing permission and outlet/tenant guards. Public callers cannot select a different bill, business, amount due, customer phone or payment confirmation status.
- Link creation uses a durable, tenant-owned claim and a short database lock; no transaction stays open during the provider call. A request key is retained across retries, including after gateway confirmation. Pending requests block another link, and the existing gateway handles late, duplicate and overpaid captures through its refund path.
- Existing settings that require payment before order approval remain unsupported by this post-invoice checkout; guests are directed to staff instead of claiming prepayment succeeded.
- Existing product/order flows remain compatible. No schema migration or deployment was performed for this feature.

Live setup

The restaurant owner must connect its own Razorpay account in Settings → Payment gateway, configure the supplied webhook URL and secret at Razorpay, and set the real public backend URL. SMS credentials are needed for production phone verification. Development-only OTP display is never used in production. When the gateway is disabled, guests are directed to pay staff. No merchant credentials are created or changed by the feature tests.

Verification

- backend/scripts/qr-checkout-tests.mjs: real local HTTP/database flows with a simulated gateway; permissions/tenants, OTP/redemption, final totals, concurrent/retried links, two shares, cancellation and exactly-once loyalty.
- backend/scripts/rls-isolated-check.mjs --quick --checkout: disposable PostgreSQL with restricted runtime roles and forced row-level security.
- QrCheckout.test.js: exact share rounding, unconfigured gateway presentation, pending versus confirmed money and verified loyalty requests.
