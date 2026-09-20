# Production release tracker

This is the authoritative scope tracker for both POS and AdminCore. Read it together with CONTINUE_HERE.md before resuming. Updated 2026-09-15. None of the thirteen areas is signed off yet. Existing code and passing targeted tests are evidence of progress, not a completed release.

## Latest evidence (supersedes stale status wording below)

- Both previous releases were verified live on Render; bridge secrets rotated and the legacy missing tenant mapping reconciled with successful authenticated refresh. User subsequently revoked the temporary Render key. Both Render services remain on free plans.
- Cashier settlement now has opening/counting/closing/history, immutable closed reports, server role checks, and transaction locks coordinating concurrent payments/refunds. Late collections belong to the collecting shift. PostgreSQL regressions passed. One shared drawer per outlet; cash movements and multiple tills remain outside this implementation.
- Cost snapshots protect new invoice profitability from later catalog changes. Inventory COGS and profitability share tax-exclusive discounted revenue/cost rules; GST allocation/full refunds tested. Catalog costs do not replace recipe/purchase valuation. Export formula/HTML injection regressions pass.
- Final frontend build and backend deploy check passed. Local installed-Chrome tests passed nine populated/empty screens at 390/768 widths, including actual cashier submission and Chef audit history. These are browser viewport tests; physical phone/printer/provider acceptance remains unverified.
- Current changes are awaiting publication; consult newest CONTINUE_HERE checkpoint for the exact commit/CI state. The original matrix below is a work inventory, not proof that each old gap remains present.

## Continuation protocol

1. Read this tracker and the newest checkpoint; inspect git status and both projects' current code before editing. Other work has changed AdminCore since earlier checkpoints.
2. Work in the user's priority order: deployment, database, sync, frontend errors, billing/KOT, QR, mobile, reports/inventory, hardware/payment/offline. Address discovered data-loss or security blockers immediately.
3. Identify the failing behavior, make a focused change, run the relevant regression, and record its result. Preserve tenant boundaries and existing data.
4. Before interruption, record exact files changed, commands still running, failed/passed checks, dependencies, and next action in CONTINUE_HERE.md. Never use a partial pass as release approval.
5. User explicitly skipped live deployment verification. Do not ask for the same URLs again or claim live verification. Physical devices, email credentials, gateway configuration and backup destination have not been supplied. Keep these separate from unfinished local implementation.

## Scope and evidence

| Area | Existing evidence | Remaining implementation or validation |
| --- | --- | --- |
| 1. Render/Vercel | PostgreSQL Blueprint, migration predeploy, readiness, startup retry; local checks | Validate final builds/configuration and shutdown/recovery; actual always-on service and live timeout verification skipped |
| 2. Database | Local migrations and isolated-schema comparison passed; non-demo seed; backup archive created | Duplicate default business/outlet concurrency, legacy state migration, restore drill, scheduled off-host backups and retention; production schema unverified |
| 3. AdminCore sync | Stable identity validation, queued provisioning/imports, retries, matching checks, conflict tests | Reconcile newer AdminCore worker; cross-project end-to-end create/update/delete for bills/orders/products/outlets/staff; retry history/UI, ordering, concurrent events, outage/restart tests; legacy plaintext cleanup |
| 4. Auth/security | DB sessions, hashed reset/invite tokens, staff revocation, invite takeover prevention, SMTP adapter; targeted tests | Atomic reset/token flow, refresh expiry policy, brute-force/rate controls, complete backend permission matrix/outlet isolation, frontend secret audit, SMTP delivery/retries, remaining dependency advisories |
| 5. Frontend errors | Route boundary and friendly API errors; earlier frontend build | Audit all 401/403/404/500 flows and async handlers, recovery after route/session change, final build and browser regression |
| 6. Mobile | Existing responsive screens, no current acceptance evidence | Login/dashboard/billing/QR/chef/waiter/products/reports viewport tests; overflow, touch targets, tables/cart/sidebar; real phone validation external |
| 7. Billing | Concurrent invoice/payment/refund tests, split/partial payment foundations | Unique final sequences across legacy data, GST format, void/refund approval races, shift closing/cash settlement, receipt layout, immutable finalized financial fields |
| 8. KOT/kitchen | Shared ticket creation and duplicate prevention tested | Item transitions accept/preparing/ready/served, station routing, KOT printing, history/audit, prep-time/SLA alerts, concurrent transition and order integration tests |
| 9. QR | Client payment confirmation blocked, approval conditional update | POS inbox and approval-before-kitchen end-to-end, rejection races, live tracking, table sessions, stable domain configuration; OTP/online payment/tips/service charge explicitly later |
| 10. Inventory | Receiving/movement/transfer foundations; atomic stock/approval fixes | Receiving/vendor bills/wastage/transfer completion, recipe deduction/reversal, stock audit, low-stock suggestions, historical-cost COGS and reconciliation tests |
| 11. Reports | Existing dashboard/GST reports and exports | Shared calculation rules, tax/profitability/hourly/staff/outlet comparison correctness, Excel/PDF export UI and API; scheduled reports explicitly later |
| 12. Printer/payment/offline | Scoped durable printer jobs and persisted payment foundations | Printer agent, claim recovery and actual print; verified UPI/gateway reconciliation; offline conflict/replay policy and background reports; card terminal explicitly later |
| 13. Testing | Backend deploy suite passes on last recorded revision; targeted Python worker/provisioning tests | Final cross-project test matrix, billing/KOT/QR browser flows, final frontend builds, restore drill; deployed/device verification excluded or external as noted |

## Current next work

Kitchen development: Chef acceptance and per-item progression, station filtering, SLA alerts, reason-based rejection and history UI; Waiter KOT pickup/completion queue. Backend validates transitions and role boundaries, preserves mixed ready/served aggregation, and rejects direct KOT creation for unapproved QR orders. Isolated PostgreSQL + HTTP workflow tests and final frontend/backend builds passed. Browser/device tests, durable KOT-to-AdminCore notifications, cashier settlement and remaining checklist items are still open. Current changes are local.

Latest audit: issued-invoice updates now use a shared payment lock and an edit allowlist across module and legacy routes; audit deletion is blocked. Legacy bill writes enforce backend permissions. PostgreSQL/HTTP regressions verify concurrent edits preserve payments and restricted staff are denied. KOT item updates now share the ticket-creation lock, retain concurrent audit entries, and ticket replay preserves preparation timestamps. These changes are local; full KOT transition rules, QR integration and settlement remain next, alongside the remaining checklist.

Latest workflow changes: manual AdminCore user sync now queues all assigned businesses and returns truthful pending/running status (24 relevant tests passed). POS invoice creation rejects client-confirmed non-cash payments and overpayment; regression uses real isolated PostgreSQL invoices. Additional-payment method formatting can no longer bypass confirmation. These changes are local. Next: confirmation/cancellation/refund/void transitions, then end-to-end cashier/KOT/QR/settlement tests; preserve all other unfinished areas above.

Latest: default-outlet creation now uses a stable Mongo document key and insert-only upsert; four helper tests pass. Six AdminCore authenticated ASGI sync tests pass with mocked database/POS. Historical duplicates and live Mongo concurrency remain unverified. Snapshot freshness regression is fixed (nine worker tests plus five existing AdminCore worker tests passed).

Reconcile and test the current AdminCore snapshot/event worker. Review freshness handling: only a successful completed snapshot should suppress a new refresh; a recently failed job is not fresh data. Then audit default-outlet creation and provisioning queue concurrency. Follow with an isolated cross-project sync test run using the current AdminCore tests after reviewing their database side effects.

## Release decision

Do not mark ready while there are unresolved data-leak, financial-integrity, migration, or sync-identity failures. Skipped external checks must remain explicitly unverified. A release decision requires an item-by-item result against this tracker, not merely a successful build or a count of changed files.
