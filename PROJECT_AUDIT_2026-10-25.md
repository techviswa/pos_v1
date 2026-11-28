# Project repair backlog — 25 October 2026

Initial audit scope: read-only code review of QR ordering, Central Kitchen, inventory, dashboard, reports, API integration and deployment controls, plus local database aggregate checks. The numbered findings below preserve the original observations; repair status is tracked separately. The audit helper is `backend/scripts/project-readonly-audit.mjs`.

## Role-consistent billing stock and compact checkout - 31 October 2026

Billing no longer turns denied inventory-management requests into zero ingredient
stock. A billing-authorized, outlet/business-scoped read endpoint returns only
ingredient identity, units and effective stock, using the existing central/outlet
allocation rules. Costs/vendors are excluded. Unavailable data is not presented
as a shortage; cached snapshots remain dated and server stock checks authoritative.
Waiters retain invoice creation and cash collection, as explicitly requested.

Empty-cart checkout/payment selection is disabled. Discounts, loyalty/gift cards
and tips remain available in compact expandable sections with applied values
visible. Product search/categories stay sticky with a service-neutral Order
details return action. Repeated ingredient badges are removed and supporting
stock/category text has stronger contrast.

Verification: 102 frontend tests passed plus a focused final billing fixture run.
Disposable API run coupled-88cc99154e75403abc1c806bbdff7e1b verified owner/waiter
stock parity, central fallback and real zero, cost/vendor exclusion, denied
inventory-management/other-outlet reads, empty-bill rejection, waiter invoice
creation and confirmed cash collection. Existing financial rules and records
were preserved. Other audit findings/hosted/device acceptance remain separate.

## Provided-service billing layout - 31 October 2026

POS shows only services enabled for the business. A sole service has no selector
or service-name card, and new empty orders select it automatically. Multiple
provided services use compact buttons; disabled services are absent from the DOM.
The duplicate non-table handover card is replaced by a small tracking line, and
single-service forms no longer tell the operator to choose a service above.
If a live policy change affects a cart, explicit review is required instead of
silently changing the order. No services configured exposes no order controls.
Existing workflows, AdminCore control and backend enforcement are preserved.
Verification: 99 frontend tests passed, covering each single-service layout,
provided-only selection, automatic setup and cart review. Other audit findings
and hosted/device acceptance remain separate.

## Settlement and QR billing panels - 31 October 2026

Billing now separates the drawer summary, validated opening/closing action and
searchable, paged history. Closing includes a cash/variance review. Financial
calculation, transaction locking, frozen closure and replay rules are preserved.
QR requests have scoped server paging, guest/table cards, honest loading/error/
empty states, and preserved unpaid-invoice/split/without-points workflows.
Already-billed split orders are excluded before pagination. Late read/write and
split callbacks cannot update another outlet's panel; cash edits survive refresh.

Evidence: 92 frontend tests passed. Isolated API run
coupled-571aa37260064c77a1d7bb305b363f7c passed 105 scoped/searchable settlements,
frozen closure/replay and 25 pending QR requests over three authenticated HTTP
pages despite 11 earlier already-billed split orders. Actual component markup
with production CSS passed 1440/768/390/320px layout checks; desktop/mobile
screenshots were inspected. Physical till/provider/hosted acceptance is separate.
Final run coupled-dbef2fb3fab54e809f66f58f671ac772 additionally verified restricted
cashier history/current scope when outlet parameters are omitted, and 403 for
explicit other-outlet settlement/QR reads. Current/open/close/report actions
require an allowed drawer; a single assignment can be inferred. The final
production frontend build passed.
No existing operational records, features or routes were removed; no schema or
financial-rule change. Other audit findings remain open. Details/evidence are in
the companion AdminCore docs/billing-panels-2026-10-31.md and recovery-backups.

## AdminCore billing mode controls - 31 October 2026

AdminCore now owns an independent Table/Token/Pickup/Delivery policy per business,
with versioned saves, audited changes and explicit pending/confirmed delivery.
The existing authenticated entitlement bridge stores the policy in PostgreSQL SaaS
configuration. POS disables unavailable choices, preserves the cart, and checks
policy in invoice and staff-order creation. Legacy businesses retain all four
modes until explicitly configured. No modules, financial history or operational
records were removed; no schema migration or environment-file change was needed.
Active tills receive billing_modes invalidation events and reconcile on focus.
Operator entitlement changes and reconciliation now have queue priority 100.

Verification: 269 AdminCore backend tests including isolated MongoDB acceptance;
40 AdminCore UI tests; 86 POS UI tests; both production frontend builds passed.
The paired runs coupled-3d3ae52c59264a9db90ace55be1cf9a7 (full POS release suite)
and coupled-8f1906329ac94971bbe76d2f7128d235 (final priority verification) both
passed all four real AdminCore-to-POS policy combinations, stale-save rejection
and persisted policy enforcement in invoice/order services without rejected-record
creation. The latter also covers the fulfillment_mode request alias. Actual local
AdminCore browser verification loaded all four controls without saving changes.
Fixtures used disposable databases; physical till/hosted acceptance is separate.
Offline tills use the last cached policy and server validation can require recovery
after a later restriction. Other audit findings and release gates remain open.

## Billing layout repair - 31 October 2026

The billing workspace now uses the remaining flex height rather than a full-height
child below separate support panels. Shift settlement and QR requests belong to
the product scroll pane; empty QR requests collapse, while requests/errors open.
Cart items and adjustments share one scroll body, with a separate total, payment
method and Generate Bill section. Mobile retains the stacked workspace and a
sticky checkout section. No bill calculations, operational writes or features
were removed.

Verification: production frontend build passed; all 85 frontend tests passed.
An isolated rendered Billing fixture with real shift/loyalty/gift-card controls
and compiled production CSS passed Chrome geometry checks at 1915x867, 1440x900,
1024x768, 768x1024, 390x844 and 320x640. Checks cover cart visibility, checkout
reachability, independent scrolling and horizontal overflow. The fixture mocks
API data, application shell and fulfillment content; this is not a live payment
or physical till acceptance check. Evidence is retained in the companion
AdminCore recovery-backups/billing-layout-* files. Other audit items remain open.

## Invoice and console repair - 30 October 2026

Bill DTOs now use authoritative identity, amounts, currency and invoice-number
columns over stale metadata, retaining legacy invoice numbers and other metadata.
The dedicated serializer regression is in deploy:check. No native routes/features
or historical bills were removed. Local data actually contains eight zero-value
bills among nine, no official invoice numbers and total 578; no financial records
were fabricated to change that dataset.

AdminCore corrected platform administration gates, failed-read states, audit
filtering, preferences, invoice identity/currency and named filters. Backend 265
and UI 39 tests passed. Full POS suite/paired acceptance passed in AdminCore's
coupled-3da910da33514030a95df5b1415e0d3e; final backend permission acceptance passed
in coupled-8b38ff6894984295aeca1c0424b727c5. The browser tour covers 29 screens.
See AdminCore docs/console-repair-2026-10-30.md for evidence and limits. The legacy
orphaned connection remains explicitly flagged; global protected health is not
claimed green. No deployment, data reset or native feature removal occurred.

## Product quality follow-up - 30 October 2026

The secondary dashboard now accepts and validates the selected outlet, separates
cache keys by outlet, uses the selected outlet's stock/reorder levels, reports
full route/allocation counts, and surfaces unavailable databases/schema errors.
Operational sample-data fallback was removed; no native routes or business
features were removed. Dedicated isolated-database checks passed for unavailable
data, distinct outlet caches/totals/stock, foreign outlet rejection and staff
scope. Included in deploy:check.

Sales rankings expose additional rows/counts and singular unit labels, and the
legacy dashboard retains the complete computed product ranking. POS frontend:
84 tests / 29 suites passed. AdminCore quality follow-up covers structured local
forms, record details/currency, paged operations/history, late detail protection,
sync wording and mobile layouts. AdminCore backend 256 and UI 32 tests passed;
Chrome checked eleven operational screens and 320-1440px outlet layouts.
Final builds and paired release verification are recorded in AdminCore's
docs/product-quality-2026-10-30.md and docs/production-completion.md. Hosted,
financial policy and hardware acceptance remain outstanding. No data reset,
native feature removal, commit or deployment occurred.

Final paired runs: 2f6d9de9005444509fd7aaaf68edd861 passed the full POS suite and
real cross-project acceptance; 0bd8bd2c1cda401f88e8d3800d96f396 passed the final
AdminCore read-readiness guard. Both production builds passed. Original IDs/counts
were retained. One inherited credential-test business has no source counterpart;
it remains visible for connection review and its failure diagnostic is retained.
Automatic invalid refreshes are blocked, partial links stay POS-owned, and global
protected operations health deliberately stays 503 until that data review is
resolved. Safe evidence: AdminCore docs/product-quality-verification-2026-10-30.json.

## Outlet consistency correction - 30 October 2026

Both dashboard implementations now use `outlet-report-policy.js`: omit inactive
outlets without transactions, preserve historical/refunded transactions at closed
outlets, and respect selected outlet scope. Outlet fetch failures no longer become
empty success responses. Regression assertions are included in deploy:check.
AdminCore has API-backed active/inactive/archived/all management filters with
correct pagination. Verified 9 AdminCore backend tests, 5 UI tests, source policy
assertions and sales-chart tests. Read-only local audit found ten bridge-named
inactive records; none were deleted. The current smoke script already uses a
separate fixture business and cleanup. No POS features removed. Visual browser
verification and the broader production acceptance gates remain outstanding.

## Repair status — 26 October 2026

| Original items | Repair and verification |
| --- | --- |
| 1, 4 | Ledger-backed Central Kitchen with API business/outlet scope; assigned-outlet and foreign-tenant checks in `central-kitchen-repair-tests.mjs`. |
| 2 | PostgreSQL outlet, purchase-order and route writes; atomic sync outbox; durable request fingerprints and transaction locks prevent duplicate/retried writes. Concurrent purchase-order and transfer retries verified. |
| 3 | Local RLS active: restricted system/tenant roles, 62 protected models, 61 direct SQL checks. Hosted deployment remains a separate release step. |
| 5, 11 | Transfer request → approval/dispatch → receipt; truthful pending labels; weekly count/detail include only received transfers since Monday UTC. Current-week versus historical receipt checks pass. |
| 6 | Inactive outlets excluded from operational selectors. Smoke tests now use and clean up isolated businesses and suppress outbound fixture notifications; existing business history retained. Worker batch-rejects orphaned business jobs without delaying legitimate jobs. |
| 7–9 | Configured reorder thresholds; location-matched fractional-use forecasts; missing history and untracked balances shown explicitly. No invented zero balance or run-out estimate. |
| 10 | Real active cashier accounts, menu recipe coverage/cost/stock review, unit conversion and recorded ingredient usage. Dashboard cashier and report recipe calculations covered by fixture checks. |
| 12 | Durable own-business delivery health and snapshot reconciliation; acceptance is distinct from verified import. Existing MongoDB/AdminCore services restored without source changes. Orders/products/outlets/tables imports verified by AdminCore: 0 unresolved failures; 37 historical failures retained. Reconciliation tests cover deduplication, tenant scope, no stale-delete replay and remote acknowledgement versus completed import. |
| 13–15 | Shared response decoding, accurate client/network error classification and shared API URL strategy. Assistance, quantity/error and QR URL tests pass. Actual LAN QR menu verified after restoring frontend port 3002. |
| 16–18 | Shared quantity formatting on affected stock/report/detail screens; searchable compact outlet list; explicit show-more counts; current-location costs and permissions; polling/live/focus refresh, request sequencing, scope reset and preserved dirty cost edits. Chrome and UI checks verify real loading and draft preservation. |
| 19–20 | Reports use one server-owned date/outlet context with complete supplementary datasets; paginated invoice reads filter before pagination; customer identity uses normalized phone/bill linkage; valid ratings have their own denominator; loyalty uses actual current profile points. 22 checks cover >250 invoices, >500 feedback rows, unit conversion, unknown stock, matched totals and exports. |

Verification: the complete backend runner exited 0 (`backend/logs/audit-final-deploy-check.log`); later worker/privacy and reconciliation-proof changes passed targeted checks. Central Kitchen has 50 backend checks; report consistency has 22; sync reconciliation has 13. UI checks cover dates/retry, quantities, assistance envelopes and billing scope; a 5-second timeout under concurrent build load passed on retry with a 30-second test limit. Chrome verified Central Kitchen, staff routes, the signed-out LAN menu, the dashboard service-share chart/empty state and real report charts. Final production build exited 0 (`backend/logs/audit-final-stable-build.log`). Screenshots are in ignored `backend/logs/central-kitchen-repaired.png`, `dashboard-sales-verified.png` and `reports-sales-verified.png`. Local RLS preflight still confirms 62 protected models. Reconciliation proof is retained per successful remote import; failed snapshot attempts are not counted as completed imports. Public connection metadata no longer exposes cross-business sync history.

These statuses cover the identified code defects and local verification, not an assurance of zero future bugs. Real payment credentials, printer hardware, SMS delivery, restaurant-maintained allergen data, hosted RLS/HTTPS and independent production security/load testing remain release/operator acceptance requirements.

## Priority 0 — authorization and durable operational data

1. **Central Kitchen does not enforce outlet scope on its snapshot.** GET `/api/central-kitchen` calls `getCentralKitchenSnapshot(tenantId)` without the caller's assigned outlets. The frontend also ignores the active outlet selector. Repair both API authorization and UI filtering; a client-side filter alone is insufficient. Business isolation and outlet authorization are different controls. Evidence: `backend/src/routes/legacy.routes.js:1026`; `frontend/src/pages/CentralKitchen.js`.
2. **Central Kitchen still has process-memory write paths.** Creating an outlet appends to `legacyOutlets`, while its subsequent list reads real PostgreSQL outlets. Purchase orders and route plans append to process-local arrays; restart loses those records and another backend process will not share them. Replace these adapters with the existing durable outlet/purchase-order/route services, with validation, idempotency and audit events. Evidence: `legacy.routes.js:1152–1217`.
3. **Database runtime isolation is not activated locally.** The RLS status check reports policies on 62 tables, but separate system/tenant connection URLs are absent. Policies existing and isolated-role tests passing do not establish that the current application connection uses the restricted runtime. Activate and verify the deployment roles before a production security claim. Evidence: `node backend/scripts/rls-status.mjs`.

## Priority 1 — operational consistency and trustworthy numbers

4. **Central Kitchen reads a different outlet-stock store.** Its snapshot uses `legacyOutletInventory`, while real stock writers use Prisma `OutletInventory` and the movement ledger. The local database contains 157 outlet-stock rows, including one nonzero balance, but the legacy snapshot does not read them. Use the ledger-backed balances and make central/outlet ownership explicit.
5. **Restock success is misleading and disconnected from the displayed history.** The Central Kitchen POST creates a durable allocation in `pending_approval`; the UI immediately says “Outlet restocked”. The snapshot reads `legacyRestockLogs`, not the transfer lifecycle. Show requested → approved/dispatched → received, and make stock available only at the appropriate step. There is currently one pending-approval allocation.
6. **Inactive test outlets are shown as connected operational outlets.** Local data: 12 outlets, 9 named `AdminCore Bridge Outlet…`, all nine inactive. Smoke tests create these records and DELETE soft-deactivates them; Central Kitchen lists all statuses. Exclude inactive outlets from operational lists, keep deliberate history access, and isolate future test fixtures. Do not hard-delete historical records merely because their names look like tests. Evidence: `backend/scripts/smoke-tests.mjs:261`, `outlets.service.js` delete/list paths, `getOutlets` in legacy routes.
7. **The low-stock threshold is wrong for configured units and reorder levels.** `stock <= Math.max(reorderLevel, 10)` forces every ingredient's threshold to at least ten, regardless of kg, packets or pieces. Eighteen of the current twenty alerts are above their configured reorder level and are flagged only by this floor. Use configured policy and display the reason for each alert. Evidence: `legacy.routes.js:356`.
8. **Run-out calculation is mathematically wrong below one unit/day.** It divides by `Math.max(avgDailyConsumption, 1)`. Example: 5 kg consumed at 0.1 kg/day becomes 5 days instead of 50. Current data has no affected fractional-use samples, but the code path is demonstrably wrong. The consumption calculation also mixes outlet movements with central balances. Forecast matched locations, handle insufficient history explicitly and distinguish low-stock alerts from predictions. Evidence: `legacy.routes.js:185,270–308`.
9. **Unknown usage is presented as zero.** All twenty currently flagged ingredients have no recent recorded consumption. Show “Not enough usage history”, observation window and stock location, rather than imply a reliable forecast. This is partly data completeness, not proof that stock is unsynced.
10. **Some dashboard metrics are placeholders.** `cashier_count` is hardcoded to 1; recipe product count, recipe coverage and blocked product count are hardcoded to zero. The local menu actually has 43 base recipes among 46 active products. Replace placeholders with defined, scoped calculations. Evidence: `legacy.routes.js:451,466–472`.
11. **“Restocks this week” is not a weekly calculation.** It is the length of the legacy restock array, with neither a date filter nor a completed-transfer definition. Evidence: `legacy.routes.js:497`.
12. **AdminCore delivery failures need reconciliation.** The audited business has 33 failed `admincore.notify-change` jobs and 16 completed ones. Inspect failure causes and reconcile each resource/version against AdminCore before replay. These counts do not prove every resource is out of sync. Provide visible sync health, retry/reconciliation and durable status; never declare “linked” equivalent to “fully synced”. No AdminCore project changes were made.
13. **Guest assistance still assumes a wrapped Axios response.** `QrTableAssistance.jsx` reads `response.data.data` for GET/POST, whereas the global interceptor in `index.js` unwraps `{success,data}`. GET can silently clear request history; POST can report failure after the server accepted the request. Standardize response decoding and test the actual interceptor behaviour.
14. **Local JavaScript errors are misclassified as backend outages.** `apiErrors.js` treats any error without `.response` as a connection failure. Distinguish HTTP failures, actual network/timeout failures, cancellations and client parsing/render errors. Preserve diagnostics while showing an accurate recovery action.

## Priority 2 — consistent application behaviour and usability

15. **API base URLs are duplicated and contain an old cloud fallback.** Many pages copy URL resolution and default non-localhost traffic to a particular Render service; QR URLs use another resolver. Use one deliberate configuration/proxy strategy for staff and public routes. The current environment may override this, so this is a confirmed code/configuration hazard, not proof that today's requests hit the wrong server.
16. **Quantities are rendered raw across multiple screens.** Central Kitchen, Inventory and several report/detail tables interpolate unformatted floating-point values. The screenshot's `4.970000000000001 kg` is a display defect. Introduce shared quantity/unit formatting without rounding away ledger accuracy. Money and quantities need different precision rules.
17. **Central Kitchen hides work behind arbitrary slices and oversized cards.** Forecast shows only the first six alerts; purchase orders/routes/history have other fixed slices without pagination in those tables. Compact searchable outlet rows, status filters, clear counts, paging/drill-down and actionable empty states are needed. Labels such as “stock lines”, “open PO” and “Window not set” need plain-language explanations.
18. **Central Kitchen can remain stale or overwrite unsaved drafts.** `useAutoRefresh(fetchSnapshot)` has no interval/live resources/focus refresh configured, so it is essentially initial-load only. Every fetch also recreates all conversion-cost drafts. Add explicit refresh/loading/staleness/error handling while preserving dirty inputs.
19. **Reports combine different scopes and incomplete supplementary datasets.** The primary report request has dates/outlet, while supplementary bills/products/feedback/customer analytics requests do not consistently carry those filters. The UI asks for 500 rows but shared pagination caps the relevant lists at 250, without automatic multi-page loading. Reconcile totals, lists and exports against the same dataset/scope before relying on large-volume results.
20. **Legacy feedback/customer report calculations are inconsistent.** General feedback averages include unrated records as zero and stop at 500 entries. Customer analytics keys bill profiles by phone when present but tries to attach feedback by customer name; feedback in report context is not filtered by the report's date/outlet. The newer QR service analytics handles ratings differently. Standardize identifiers, rating denominators and report scope. There is no current feedback data in the audited business, so this is a confirmed code defect rather than a current numerical discrepancy.

## Setup and release checks — separate from code defects

- None of the 46 active products has its dish-level allergen review marked complete. Ingredient propagation exists; staff must supply and review accurate supplier/kitchen information. Unknown labels should remain unknown, not be auto-certified.
- Live payment links/webhooks, SMS delivery, printer hardware, phone access on the deployment network, offline recovery and multi-device concurrency still need operational acceptance tests with the intended deployment configuration.
- Both local frontend ports have been in use. Cache separation and background preload handling were repaired earlier; verify the supported launch path and release process so tests and users exercise the same instance.
- Tenant referential audit checked 86 relationships and found zero cross-business violations. This is positive evidence for that check only, not an independent security certification.
- Existing test suites and earlier fixes are not proof that all screens have been audited. This list is the confirmed backlog from this pass; additional failures can emerge during repair and acceptance testing.

## Repair order

1. Outlet authorization, durable Central Kitchen writes and restricted DB runtime activation.
2. Ledger-backed stock/transfer views; test-fixture/status cleanup; reliable sync reconciliation.
3. Forecasts, thresholds, dashboard/report calculations and consistent response/error handling.
4. Shared API configuration, formatting, compact layouts and workflow clarity.
5. Full regression and real-device/operator acceptance against one documented deployment.
# Local RLS activation update — 2026-10-25

Audit item 3: local runtime activation is complete. A pre-activation PostgreSQL
backup was taken; restricted system and tenant roles are configured; all 62
application models passed runtime preflight; 61 direct database isolation checks
passed; the backend was restarted and readiness passed. Administrator password
recovery was explicitly approved, original authentication restored byte-for-byte,
and the administrator credential removed from application env. Hosted activation,
independent security testing and the other audit repairs remain separate work.


## AdminCore integration verification - 28 October 2026

Additive bridge work preserves existing POS routes and features. Product commands
support deterministic source IDs, request replay, stale-version conflicts and
atomic product/options/outbox writes. Stock adjustments hold a row lock and accept
request IDs. Isolated tests passed for concurrent adjustments and retry replay.

Read-only exports now include tip payouts, payslips, loyalty entries, gift-card
transactions and marketing delivery. Allowlists exclude private pay profiles,
redemption codes and message/provider payloads. Six export tests passed; all five
populated views also passed through actual POS/AdminCore APIs and durable workers.
The paired check passed restart recovery with a demonstrably unconfirmed command
and a POS-only change reaching AdminCore without a browser.

AdminCore tests/coupled_api_check.py creates disposable databases; --pos-suite
also runs the full POS release suite there. This does not certify hosted RLS,
providers, printers or offline multi-till operations. Legacy snapshot/identity
paths, privacy retention and money acceptance remain open
in AdminCore docs/production-completion.md. No production deployment is claimed.

## Outlet recovery and export cursors - 28 October 2026

Outlet commands now use deterministic IDs, replay receipts, expected source
versions and atomic staff/menu/inventory/feature/outbox writes. Isolated tests
cover concurrent replay, stale requests and parent-transaction rollback.
AdminCore's paired API check also verifies pending outlet/product commands finish
after stopping and restarting the real worker. Deactivation retains history.

Bridge paging version 3 uses signed, scoped bounded-ID continuations. Deletes of
earlier rows and edits to later rows cannot shift the remaining rows out of a
page. Grouped exports track each underlying model separately. Native POS screens
keep their existing query behavior. Five cursor tests and real database tests
pass, including customer exports and assistance state-document keys. AdminCore
only reconciles absence from complete unfiltered cursor exports; partial and
legacy exports cannot hide unrelated records. Roll out its new client first.

These are bounded reads, not frozen financial snapshots. Concurrent new records
may require the next reconciliation. The synchronous 50,000-row cap, privacy
retention, hosted verification and remaining audit items remain open.

## Integration hardening - 29 October 2026

The newer bridge adds durable repeatable-read export snapshots (`frozen_exports:
1`), privacy erasure exports and initiating-user checks (`actor_checks: 1`). Native
POS routes, screens and features remain available. Staff create/update/delete now
retain their notifications in the same transaction. Business-owner changes share
a transaction lock and recheck the current actor, preventing concurrent removal
of the last active Owner. Credential command receipts confirm retries without
repeating session revocation. Password-only edits preserve role, explicit custom
permissions, outlet assignments and profile requirements.

Customer erasure preserves financial amounts while clearing receipt-derived
contacts, feedback and queued marketing recipient data. Keyed erasure markers and
receipt references reach AdminCore; retained snapshots are invalidated. Snapshot
chunks expire after 15 minutes. Background exports are bounded at 1,000,000 rows;
legacy derived collectors have a 64 MiB budget and return explicit limit errors.
Legacy customer exports use net invoice amounts and separate currencies, avoiding
the previous addition of order amounts to invoiced spend.

Offline capture stores receipts individually, retains original scope during
replay, refuses unavailable/corrupt/full storage without dropping earlier sales,
and exposes a recovery copy. Legacy queues remain available for recovery. Multiple
tills competing for final stock have an isolated database acceptance check.

Latest frontend regression: 28 suites / 83 tests passed, including 15 offline
queue tests. AdminCore backend regression: 252 tests passed with real isolated
MongoDB checks. Both production builds passed. Headless offline checkout and the
paired API/credential checks passed; combined release evidence is recorded in
AdminCore docs/production-completion.md.
Hosted configuration, provider approval, physical devices and business acceptance
of financial rules remain release gates. No deployment or database reset occurred.

Staff bridge exports now use read-only scoped cursor reads rather than the native
screen's role-default initializer. This avoids writes inside frozen snapshots and
preserves native staff behavior. New credential creates reject email collisions
instead of taking over existing POS identities; matching receipts still replay.
Delivery addresses/instructions and legacy field aliases participate in erasure,
while quantities, product names and invoice amounts remain. Offline acceptance
primes the service channel's own menu cache and fills current delivery validation.

Final combined release passed: AdminCore
`recovery-backups/coupled-5eba4e97321142da910261f2c0202868/result.json`.
It includes the full POS suite, headless offline checkout, staff create/update
replay, two-till stock recovery, frozen exports, PostgreSQL all-63-table/BSON
restoration and real paired API/worker restart delivery. Local services were
reloaded with AdminCore UI 3001/API 8000 and POS API 4001. Original business,
product and table IDs and the recorded counts remain unchanged. POS UI was not
started, and neither repository was published or deployed.

Follow-up live-data regression found legacy kitchen DTOs missing the tenant field.
The bridge now adds it from the verified source business, rejects mismatched rows,
and retains normalized arrays. Native kitchen responses and workflows remain
unchanged. Populated kitchen delivery and erasure by order reference passed in
AdminCore `recovery-backups/coupled-a2cb3a0a919a4187bbdd8ac59cb16e01/result.json`.
The local API was reloaded and its original populated kitchen import is synced.
Final safe evidence/fingerprints: AdminCore
`docs/production-verification-2026-10-29.json`.

## 2026-11-01: shared shop profile and AdminCore business identity

Replaced unscoped browser-only shop details with a business-owned PostgreSQL
profile, keeping the Business name canonical. Registered the profile key with
the tenant guard, committed profile/revision/outbox changes together, and reused
the active frozen-export transaction for consistent profile reads. Business
name is visible in the shared POS header and sidebar, separately from staff.

GST/contact/receipt/display preferences are exported to AdminCore. Connected
AdminCore renames require the POS revision and acknowledgement. Older snapshots,
late account responses, failed saves and stale editor revisions cannot silently
replace the confirmed profile. Browser preferences are retained for explicit
review; failed table-settings reads block saves and provide retry, and background
profile refresh preserves drafts. No POS routes or features were removed.

Evidence: AdminCore `docs/business-profile-sync-2026-11-01.md` and isolated run
`recovery-backups/coupled-aced03a0e6b142f08c1014c131927ae4/result.json`.
113 POS UI tests, 44 AdminCore UI tests, both CI production builds and the profile
round trip passed. Hosted/provider/device/financial acceptance gates remain open.

Follow-up Settings checks corrected real personal account-name persistence through
the existing staff self-profile route, actual account email display under existing
staff administration policy, mobile card/table overflow, and invented migration
defaults in browsers without legacy settings. Account-name delivery to AdminCore
and invalid-name rejection passed in the same isolated run; actual merchant data
was not used for write tests. Live browser checks confirmed every Settings card
fits and the signed-in business name remains visible across Settings and Billing.

## 2026-11-01: billing workspaces and service recovery

Moved invoice recall into Bills & history with server-side outlet-scoped paging,
search, payment/amount/date filters and stale-response guards. PostgreSQL applies
scope and filters before its bounded page, with a stable timestamp/ID ordering.
Ordinary array responses and frozen exports retain their contracts. Linked items
reuse current menu prices and combined stock checks for a new sale; historical
items without product links request manual selection instead of inventing SKUs.

Moved the existing drawer/shift and settlement workflow into its own Cash drawer
page, retaining role boundaries and explicit first-load behavior. Kept guest bill
requests in a compact checkout dialog. Waiter invoice/payment access remains.
Adjusted cart width, description wrapping, quantity controls, empty/optional
sections and mobile cart/product shortcuts. No existing merchant records deleted.

Evidence: AdminCore `docs/billing-workspaces-2026-11-01.md`; disposable API run
`970cb029b897485ba3f20d6053df472c`. POS 131 UI tests, AdminCore 45 UI tests, both CI
production builds and read-only actual browser checks passed. The Admin API had
been stopped; the canonical Admin launcher now tracks the actual Windows Python
interpreter. Local subscription and overview reads recovered. Hosted/provider/
device/financial approval gates remain open; no production deployment occurred.

## 2026-11-25: pre-deployment verification

Re-ran every check on the snapshot commit before deploying. POS `deploy:check`
passed; POS 37 suites / 131 UI tests passed; POS production build compiled.
AdminCore 269 backend tests (8 skipped) and 15 suites / 45 UI tests passed; its
production build compiled. The browser checks had drifted from the 2026-11-01 UI
moves: settlement is now exercised on `/cash-drawer` with the two-step
review/confirm close, and the offline till locates service buttons by their text.
After those test updates, `test:browser` (mobile viewports, settlement, offline
till reload/sale/sync) passed. `render.yaml` gained `SENTRY_DSN` and
`SENTRY_ENVIRONMENT`; DEPLOYMENT.md gained Razorpay till, Plan & Billing and
Sentry setup. Hosted secrets, Razorpay accounts and Sentry DSNs remain operator
inputs.
## 2026-11-26: live operator fixes (Bheemas Cafe)

- Fixed: purchase receiving returned 403 TENANT_REFERENCE_FORBIDDEN for every signed-in user (replay record lacked `business_id`). Evidence: live request 647a7a03 failed, passes after fix; scoped regression in `inventory-accounting-tests.mjs`. Audit of all other StateDocument writes found no further cases.
- Fixed: receipts had no print action; printed feedback link pointed at the API host (404). Shared 80 mm receipt (`core/billing/receipt/printReceipt.js`) on checkout and Bills; verified on live by capturing the printed text.
- Fixed: Plan & Billing 503 when AdminCore billing is not linked; now shows local plan, usage and features (`saas-billing-tests.mjs`).
- Improved: Cash drawer summary and zero-float note; table/category/reservation forms use Notes and Position instead of raw JSON / Sort Order.
- Verified: `deploy:check` passed, 38 frontend suites / 135 tests passed, build compiled, live browser checks of Billing, Bills print, Cash drawer and Plan.
- Open: AdminCore link for online plan payments; KOT is not in the Starter plan; table release after payment is a manual staff action.

## 2026-11-26 (later): live A-to-Z QR demo and project sweep

Live end-to-end on Bheemas Cafe (trial data): QR codes generated for 13 tables; guest
order at T2 (2 Cappuccino + Veg Sandwich) placed, staff-approved, bill requested,
issued (CF-MAIN-20261125-0002, Rs 400 + Rs 72 GST), cash collected on Bills, receipt
printed, guest feedback 5/5 recorded, customer + 20 loyalty points created. Main
Outlet stock fell by exactly the recipe quantities; central kitchen unchanged; cash
drawer Rs 767 for 2 bills; Reports and GST report match.

- Fixed: QR orders had no outlet (stock would come from central, cash to no drawer). `table-outlet.js`, `qr-table-outlet-tests.mjs`; table form Outlet field for multi-outlet businesses.
- Fixed: QR ordering is off by default with no hint; QR screen now says so with one-click enable. LAN-only Wi-Fi note no longer shown on public links.
- Fixed: screens for plan features the business lacks (KOT on Starter) were shown and returned 403; app now follows `GET /api/features`.
- Fixed: no UI to collect payment on unpaid (QR/Due) bills, confirm UPI/card references or void a bill (`BillPayments.jsx`).
- Fixed: till and Products compared/costed recipe quantities without unit conversion (150 ml vs 24.7 l; Rs 9,000 instead of Rs 9). `lib/recipeUnits.js`.
- Fixed: Dashboard profit counted GST as income and re-costed old bills at today's prices; now uses Reports' calculation and flags items sold without a cost (`dashboard-profit-tests.mjs`).
- Fixed: bills ignored the tax rate saved in Settings (hardcoded 18%) while the till showed the Settings rate (`tax-rate-tests.mjs`).
- Fixed: QR guest total omitted GST and rounded service charge to whole rupees; reservation planner used the UTC day (wrong "today" before 5:30 am IST).
- Open (no UI yet): physical stock count (`POST /api/inventory/stock-audits`), manual UPI intent confirm, outlet purchase-order approve/reject, delivery route start/complete (status names also disagree), scheduled reports (no scheduler), batch tracking and barcode screens (listed as plan features), outlet deactivation, editing a pending allocation, vendor bill without receipt. Till stock check ignores combo components and modifier recipes (server still refuses correctly).

## 2026-11-26 (later): half-built workflows completed

- Done: Central Kitchen purchase orders can be approved (dispatches a linked transfer from central stock, refused with the shortfall if stock is short) or rejected with a reason; open until received. Delivery routes start and complete. Live demo: PO for 2 l milk approved, dispatched, received (central 15 -> 13 l, outlet +2 l); route scheduled -> in transit -> delivered. `central-kitchen-decision-tests.mjs`.
- Done: scheduled reports run for the last finished period, are emailed once per period by a background sender (claim record per period), and record "not sent" when SMTP is not configured. Reports > Scheduled tab; live: schedule added, "Run now" downloaded the GST CSV (voided bill excluded). `report-schedule-tests.mjs`. Email delivery needs SMTP_HOST/SMTP_FROM (and credentials) on the backend.
- Done: closing an outlet is refused while its shift is open, transfers are unfinished or bills are unpaid; closed outlets take no bills/QR orders and free their plan slot; reopening checks the plan. `outlet-close-tests.mjs`.
- Done: till stock check mirrors server deduction for combos and option-linked products/recipes (`saleDemand`).
- Done: plan-gated purchase-order approve/reject only act on pending orders.
- Done (user approved the additive migration `20261126090000_barcodes_and_batches`, local DB backed up first): product barcodes (unique per business, Enterprise plan, in-store EAN-13 generation, label printing, scan at the till) and batch tracking (lot + expiry captured at receiving, linked to item/location/cost, earliest-expiry-first remaining estimate, expiry alerts). `barcode-batch-tests.mjs`.
- Fixed: a business with no saved feature switches received every feature (including Enterprise ones); it now gets its plan's features.
- Done: a manual UPI request made at the till closes when its payment is confirmed on Bills; a payment still being collected via Razorpay cannot be confirmed by hand (`upi-request-confirm-tests.mjs`).

## 2026-11-27: QR Studio

- Done: printed QR design for every plan (`/api/table-management/qr-design`): colours (server and device refuse light-on-dark and contrast below 4.5:1), dot/corner/frame styles, centre logo up to 24% width with error correction H, call to action, table name. Every code is decoded with jsQR at print size and small size before download, save or print; timing/alignment modules stay square. Browser check: 27 of 27 style combinations with the largest logo and all 5 palettes scan; table cards print as A6 cards or A4 sticker sheets after all codes are checked.
- Done (user approved the additive migrations `20261127090000_qr_links` and `20261127091000_qr_links_runtime_access`, local DB backed up first): smart codes `/q/<token>` (browse menu, offer, review, contact card, web link) with editable destination, switch off/on, scan log and outlet scope; plan feature `qr-studio` (Growth, Enterprise). Row security and runtime-role grants match table QR codes (`rls-database-tests.mjs` now 64 models, cross-business QR link checks).
- Done: guest-menu look per outlet (logo, cover, accent, welcome, chef's picks, YouTube/Vimeo videos loaded on tap) on table menus and smart codes; QR performance per code (scans, approved QR orders and value, orders per scan, smart-code scans and devices, scans by hour, definitions shown).
- Verified: `qr-studio-tests.mjs` (50 checks), full `deploy:check`, frontend build and 164 tests, browser run on an isolated Enterprise fixture (deleted afterwards).
- Not built (needs paid storage and keys): uploading/hosting own videos; drag-and-drop page builder; campaign links in WhatsApp/SMS marketing.

## 2026-11-28: production scale (billing, inventory, reports, staff sign-in, cloud backup)

Measured on an isolated fixture: one year of a busy two-outlet cafe (120,451 bills, 361,351 lines, 204,765 stock
movements; `scripts/scale-bench.mjs`), then deleted.

| Request | Before | After |
| --- | --- | --- |
| Bills list (owner / cashier, page of 50) | 16 s / crash (32,767-parameter limit) | 0.1 s / 0.1 s |
| Dashboard | crash after 22 s | 1.0-1.9 s |
| Reports overview, 30 days / 1 year | 5.4 s / crash | 1.4 s / 3.3 s (guests load on their tab) |
| Hourly, products, staff, outlets (30 days) | 4.2-4.6 s | 0.2-0.5 s |
| Inventory list | 11.8 s | 0.05 s |
| 40 bills at once on 2 tills | 0.29 s per bill | 0.13 s per bill, unique numbers, exact stock |

- Fixed: 40 missing indexes (foreign keys followed by row-security rules; business/date lookups) — migrations
  `20261128090000_scale_indexes`, `20261128091000_bill_updated_index` (additive). Schema drift: none.
- Fixed: every "load all bills/orders/movements" path in these features (reports, dashboard, outlets list, outlet
  detail, inventory list, central kitchen, stock valuation, shift summary, customer search/history sync, privacy
  erasure, billing summary that counted only 100 bills, tenant export) now reads in batches, sums in SQL or uses saved
  daily totals (`sales-day:`/`report-day:`, recomputed for any day whose bills change). Saved-day figures were checked
  equal to live per-bill figures on the fixture (30 days, all outlets and one outlet).
- Fixed: reports, dashboard, bill date filters and scheduled reports counted UTC days/hours (lunch at 13:00 appeared
  at 07:30; bills before 05:30 went to the previous day). Business time zone added to Settings (default Asia/Kolkata).
- Fixed: raw SQL compared timestamps in the database session's time zone (`sqlTime`).
- Fixed: simultaneous QR payment requests with one key could create two payment links (reproducible).
- Fixed: password/PIN checks blocked the server; expired sessions never deleted.
- Limits by design: report ranges up to 366 days; guest analytics and invoice-level GST up to 92 days per request.
  Dashboard and Reports always include the latest bills. Dashboard lists show the newest 200 bills with the
  full count.
- Done (storage keys pending from the owner): nightly encrypted off-site backup (S3-compatible), verified from the
  stored copy, retention 30 daily + 12 monthly, Settings status, owner data download, restore and drill commands.
  Local drill: 766,147 rows / 64 tables backed up (39 MB), verified, restored with 93 foreign keys, every table equal.
- Verified: `scale-correctness-tests` (33), `backup-tests` (23), `auth-scale-tests` (8), full deploy check, frontend
  build and 164 tests. Not verified here: live Render behaviour under this volume (free instance), real R2/B2 bucket.
