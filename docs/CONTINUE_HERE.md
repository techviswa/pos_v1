# Resume checkpoint — read this before continuing

## User authorization and objective

The user authorized reviewing and improving both projects toward a production-ready multi-business restaurant platform comparable in scope to Petpooja, Toast, GoFrugal and Odoo. The original thirteen-area production checklist remains the scope. They specifically asked for reliable continuation after credit limits or interruptions. Do not restart, discard existing work, or claim full completion.

POS: `C:\Users\viswa\OneDrive\Desktop\viswa pos table error`

AdminCore: `C:\Users\viswa\OneDrive\Desktop\pos admin panel - Copy\pos admin panel not 1drive`

Follow POS `AGENTS.md`. No AdminCore AGENTS.md was found. User permission includes AdminCore edits and necessary DB configuration changes. No subagents have been authorized. Preserve user data, local secrets and the current architecture.

## Exact interruption

### Recipe units and explicit stock reversal (2026-09-21, latest)

- Implemented recipe-units.js: mass (kg/g/mg), volume (l/ml), count aliases, same custom units; absent recipe unit inherits ingredient unit. Different dimensions/unsupported conversions fail clearly. Demand aggregation preserves units until conversion, so 250 g + 0.25 kg correctly consumes 0.5 kg. Costs use converted quantities.
- New POST /api/billing/:invoiceId/stock-reversal and Bills dialog manager form. Only Owner/Manager; requires reason and explicit unused-ingredients attestation, only void/full-refund invoices with trusted consumption snapshots. Restores original outlet/central stock, audits each movement and actor, persists reversal and AdminCore job in one transaction. Bill advisory lock/idempotent recorded result prevent duplicate concurrent restoration. A refund alone NEVER restores prepared food. No guessed reversal for old invoices lacking snapshots.
- PostgreSQL production-flow PASS: mixed unit conversion, incompatible dimension rejection, role/tenant/status validation, refund without automatic restock, concurrent idempotent restoration, outbox-failure rollback. Frontend production build 4874 PASS; backend deploy check 61361 PASS. Chrome suite 15489 PASS: ten routes at 390/768 (20 checks), including actual Bills restoration form and replay, settlement, populated Chef history and QR. Added full DB workflows to GitHub CI.
- AdminCore investigation: read-only health request timed out after 30,202 ms; immediate retry healthy in 494 ms, config_ok true, revision 5379db8. Existing /api/health does not perform POS/database calls. Last verified live Render plans were free; revoked API key prevents rechecking/changing instances. Render docs https://render.com/docs/free describe idle spin-down; POS blueprint already says starter but does not prove deployed plan. Asked user asynchronously to switch both instances or reconnect Render access. No response yet; do not treat silence as access or plan change.
- Physical device checks: no adb command or present Android/iPhone/WPD device found; no connected device-testing tool. Asked user for Android USB or device-cloud access. Browser emulation passed, physical acceptance remains blocked by missing device access. No fabricated physical test claim.
- This unit/reversal batch awaits commit/push at checkpoint write. Next: publish and check CI, then finish hosting/device verification when requested access arrives. Broader inventory valuation and 13-area release matrix still apply; explicit whole-invoice unused ingredient reversal does not implement arbitrary partial returns or supplier returns.

### Source transfers and recipe accounting (2026-09-21, newest)

- Transfer source now validates tenant-owned outlet IDs and rejects same source/destination. Approval debits source OutletInventory when specified, otherwise central InventoryItem. Receiving credits destination as before. Owner/Manager approval enforced in service. Approval and receipt notifications now use the same transaction as stock/status changes; injected outbox failure rolls back approval. PostgreSQL tests cover these, source/destination stock conservation and role rejection.
- Recipe billing now deducts the billing outlet's ingredient stock (or central for unscoped billing), fails on missing/insufficient ingredient stock instead of silently clamping, and rolls back invoice on failure. Fractional item quantities no longer inflate to one. Ingredient costs/quantities are snapshotted in private bill metadata; item cost snapshots use weighted recipe costs per product within the invoice. Historical recipe COGS stays stable after ingredient cost edits. Recipe consumption queues inventory notification transactionally.
- Full production-flow regression passed after latest source/recipe/role changes. Backend deploy check and 18 populated browser viewport checks (nine routes at 390/768) passed earlier in this batch. No frontend changes. This remains emulation, not actual physical-device testing.
- Live POS readiness returned 200. AdminCore first request timed out, retry 200: always-on hosting remains unresolved. Temporary Render key is revoked, so exact backend revision/authenticated production actions were not verified. Changes awaiting publication after checkpoint.
- Still necessary: recipe-unit conversion validation, explicit audited restocking/reversal policy (a money refund must not automatically restore prepared food), outlet-specific ingredient cost valuation (current snapshot uses business ingredient average), transfer request creation outbox, and broader live/device acceptance. Do not claim recipe accounting or entire platform completely finished. Continue from these concrete gaps, preserving completed patches.

### Inventory reconciliation continuation (2026-09-21, latest)

- FINAL UPDATE superseding publication notes below: e1ccae6 settlement/report and 8a01fc9 receiving/audit are pushed and CI SUCCESS. Wastage fix pushed as 040dbebd6efedfe44ad750801a3990372617d2b0; CI last observed running. Transfer quantity injection is now fixed and DB-tested: new requests retain only allowed fields/positive requested quantity; approval uses requested quantity; receiving uses only approved quantity and rejects replay. Test injected approved=7/received=999 into requested=2 and verifies only 2 deducted/received. Transfer follow-up to be committed after this checkpoint update. No frontend changes after prior successful build.
- Remaining transfer work: source-outlet semantics (current stock debit is central inventory), per-role approval review and moving transfer notifications into their transaction. Recipe consumption/reversal and valuation need audit. Latest full PostgreSQL workflow test passed after transfer sanitization. Exact latest Render revisions and full authenticated production sync still unverified. Public health success does not close these gaps.

- Publication update: receiving/stock-audit corrections pushed as 8a01fc9caac1315b949738c151220d6beacb49b2; CI last observed in progress. Follow-up wastage correction now also passes PostgreSQL tests: strict quantity/ID validation and a single transaction for stock, movement audit and AdminCore notification. Injected notification failure proves stock and movement rollback; successful wastage persists its queue job. This follow-up awaits commit/push.
- Concrete next review finding: transfer creation spreads caller-supplied line fields, while approval/receiving prefer approved_quantity/received_quantity. Audit trusted quantities and source outlet scope before claiming transfers ready. Recipe reversal/valuation and full AdminCore end-to-end remain unfinished. Do not lose these findings on continuation.

- Published previous verified settlement/report batch as e1ccae64ed4f817d08c5c529000b362437fe418b. GitHub run 35544889361 completed SUCCESS; Vercel commit status SUCCESS. POS public readiness returned 200. AdminCore public health timed out once (25 seconds), then returned 200 on retry. Exact Render backend revision for this batch has not been verified; user revoked temporary key. Do not equate public health with full authenticated production regression.
- Fixed purchase receiving: fractional stock weighted-cost denominator, concurrent valuation through transaction/advisory and item row locks, strict positive quantities/nonnegative costs, and reject supplied unowned/missing inventory IDs rather than silently creating an item. Entire multi-line receipt rolls back on invalid item.
- Fixed stock audits: require unique explicit item IDs and finite nonnegative counts; prevents missing IDs selecting an arbitrary item and malformed values becoming zero. Lock before reading stock so concurrent counts do not double-apply stale variance. Receiving/audit AdminCore outbox jobs now commit atomically with their stock changes.
- Latest PostgreSQL production-flow tests PASS after both changes: fractional/concurrent receiving, invalid receipt rollback, malformed/duplicate counts, concurrent audit variance, persisted sync jobs. Backend deploy check also passed. No frontend change in this continuation; prior build/mobile evidence remains applicable. Inventory changes currently awaiting commit/push and CI result.
- Next implementation review: stock transfers/wastage and recipe consumption/reversal accounting, then AdminCore report consistency. Preserve remaining full checklist; no claim of production sign-off, real-device validation or connected payment/SMS providers. Checkpoint must be updated after inventory publication.

### Verified settlement/report batch (2026-09-15, latest; supersedes older running-test notes)

- Frontend build 58809 finished successfully. Native Chrome suite 9348 PASSED all nine routes at 390 and 768 pixels: login, dashboard, billing, chef, waiter, products, reports, QR management and public QR menu. It verifies cashier open/count/close/history and populated kitchen audit history plus public menu products. No root overflow, API fallback, redirected route or runtime failure. Screenshots inspected. This is local Chrome emulation, NOT physical-phone or deployed-device validation.
- Latest PostgreSQL production-flow tests PASSED, including settlement concurrency, late collections/refunds, frozen closing history, cross-business product/order rejection, catalog-cost snapshots, report/inventory agreement, discounts, IGST allocation and full-refund tax. Final backend deploy check 31448 passed. Report CSV formula injection and HTML export markup injection fixed with regression included in deploy:check.
- AdminCore repository has no local code changes in this batch. Restored missing declared test dependencies in its .venv (httpx/qrcode/Pillow), no dependency manifest change. All 21 worker/batch/authenticated sync tests PASS, including cross-business access rejection, truthful queuing and kitchen dependency refresh. These use mocked POS/database, not live integration.
- User revoked Render API key; never read/reuse it. Earlier bridge-key rotation and legacy mapping reconciliation succeeded and remain completed. Current local changes still require Git commit/push and CI verification. Do not claim this batch deployed until verified.
- Next: publish verified batch, check CI/public health, continue inventory receiving/recipe reversal/counting reconciliation and AdminCore report consistency. Full checklist still includes physical printer/phone tests, actual provider configuration, off-host backups and always-on hosting. Existing cost snapshots are catalog costs, not recipe/purchase ledger valuation; historical fallback is flagged estimated_cost. Settlement currently means one shared drawer per outlet, not independent tills or paid-in/paid-out accounting.

### Settlement, report accuracy and viewport validation (2026-09-14, active)

- UPDATE superseding earlier browser notes below: completed local Chrome smoke on eight real screens at 390/768 widths, no page overflow/runtime errors. Initial protected-screen redirects were harness CORS failure and resolved. Final build 60032 passed; backend 77822 passed. Expanded settlement interaction caught a genuine double-unwrapping bug (shared AuthContext Axios already unwraps responses); fixed in CashierSettlement and Chef stations/history. Rebuild session 58809 currently running with GENERATE_SOURCEMAP=false. Run expanded mobile-viewport-tests only after it finishes. Expanded suite includes anonymous real QR fixture, open/count/close/history, screenshots and API-error fallback checks; not passed yet. Native Chrome needs require_escalated because sandbox GPU subprocess was denied; outside sandbox launch approved and works. No Playwright package was installed.

- User revoked the temporary Render key/deleted its file; do not attempt using it. User requests remaining settlement, inventory/report accuracy and device testing. Latest steering: finish the task; do not stop at plans.
- Added settlement.service.js using existing StateDocument storage: side-effect-free reads, per-outlet opening, cash validation, atomic closing/history, stale shift ID checks, immutable replay, opening-operator/manager checks. Business settlement lock coordinates invoice creation/payment/refund/confirmation with closing. Each new payment/refund has settlement_shift_id; later collections on old invoices belong to the collecting shift. Historical untagged records use invoice shift as fallback. Closed reports remain saved snapshots.
- Added Billing CashierSettlement panel with opening/count/variance/history and request feedback. Endpoints/panel limited to Owner/Manager/Cashier. Signed-in invoice creator passed to automatic shift creation. Existing automatic opening on financial activity retained; reads no longer open shifts.
- Added server-generated invoice item_costs snapshots without schema migration. Ordinary serializeBill hides costs. Profitability and inventory COGS use snapshot costs (legacy fallback marked estimated_cost) and the same discount/refund allocation excluding GST; GST taxable value uses net total minus tax. PostgreSQL tests pass for changed catalog costs, report agreement, discounted taxable value, late collections/refunds, closing races, immutable history and wrong-outlet denial.
- Latest backend deploy check passed (66603). Latest full DB workflow suite passed. Final frontend build still running in session 60032 after final role UI edit; wait before running browser tests against build output.
- Temporary Playwright installation was rejected by auto-review due selected model capacity. No workaround installation attempted. Implemented mobile-viewport-tests.mjs with installed Chrome/CDP pipe, isolated temporary profile/test business, and blocked external browser requests. Chrome under process sandbox failed GPU access; authorized escalated Chrome launch works. Test harness first needed production fixture mode, then CORS preflight fixes. A later test ran while build folder was being regenerated; results INVALID, not device evidence. Harness now asserts exact route and viewport and checks build exists. Run only after frontend build finishes. Physical-device tests remain unavailable.
- Browser test command from POS root: cmd /c "node backend/scripts/mobile-viewport-tests.mjs > backend/logs/mobile-viewport-latest.log 2>&1" with require_escalated (Chrome subprocess requires it). Results file backend/logs/mobile-viewport-results.json. Current request checks need verification after final build; protected screens previously redirected to login before CORS fix. Do not claim those passed.
- All development changes are local/uncommitted, no deployment performed this continuation. Broader checklist remains active. Pending browser validation/fixes, final checks, then publish authorized changes; no zero-defects/parity claim.

### Legacy mapping reconciliation (2026-09-14, latest)

- User authorized repair of the legacy 403 mapping. Temporary Render API key remains valid at the previously recorded path. Revocation is recommended after maintenance, not mandatory; no key was deleted or revoked by the agent.
- Affected AdminCore business 6a958621e493c64d6a1492a7 already referenced POS business 6a88e44ab52fe438ec958a60, but had no pos_tenant_id. Its existing linked outlet stored admincore-6a88e44ab52fe438ec958a60. Live POS business export confirmed that exact business/tenant pair; only one AdminCore business references that POS ID, and the remote legacy AdminCore ID has no competing local business.
- Atomically filled only the missing pos_tenant_id plus updated_at and inserted an audit log using a MongoDB transaction and conditional update. Business ownership and external ID were unchanged. Repaired scope now returns 200 on live POS order export.
- Initial verification submission timed out; no matching durable job was found. Stable verification event legacy-mapping-reconciliation-6a958621e493c64d6a1492a7-20260914 then completed synced on attempt 1, result success, error_count 0, no last error, finished 2026-09-14T08:42:10.984648+00:00. This legacy 403 mapping is RESOLVED. No customer transactions were created. No command running; local checkpoint documentation is uncommitted.

### Render bridge-secret rotation completed (latest)

- User supplied a Render API key in C:\Users\viswa\OneDrive\Documents\render api key agent.v1. Do not print, copy into the project, or commit its contents. Key access was verified for AdminCore srv-da77ev1srm7s73flihdg and POS srv-da6j398n74is73fa4r4g. Both services currently use the free plan; no billing changes made.
- Rotated AdminCore POS_CORE_API_KEY and ADMINCORE_API_KEY plus POS ADMINCORE_API_KEY to one generated 48-byte random token. Values remained in process memory/Render only and were verified equal without output. Targeted variable updates preserved other configuration.
- Redeployed existing builds: AdminCore dep-dajedegae00c739l8drg and POS dep-dajedelg1s2s73aehi0g both live, at revisions 5379db8 and 52e0385 respectively. AdminCore health production_config_ok is now true with no errors. Prior development-key blocker is SOLVED; do not repeat stale blocker statements below.
- Live authentication verified: new secret scoped POS orders export 200; old development secret rejected 401 by POS export and AdminCore webhook. A normal refresh event for one already provisioned business (no new sales/customer transactions) completed: bridge-rotation-verification-183dd18d-7352-4243-b223-9b31e7339194, status synced, attempts 1, result success, error_count 0, finished 2026-09-13T18:13:06.570618+00:00. Order processor includes kitchen-tickets/customers/reports dependencies.
- Remaining observed issue: first legacy business mapping with pos_external_id but no explicit pos_tenant_id/provisioning status returns scoped 403. Four other inspected mappings export successfully (one still has historical provisioning_status failed despite successful export). No ownership mappings changed or guessed. Investigate/reconcile legacy mappings and stale provisioning statuses next; single-business verification is not all-business sign-off.
- Access file remains at user location and temporary Render key has not been revoked. No command running. Checkpoint changes are local documentation only.

### AdminCore release and transactional kitchen sync (latest)

- AdminCore commit 5379db8 pushed to origin/master: manual user sync queues all assigned businesses; truthful pending/running toast; order imports refresh kitchen-tickets before customers/reports and propagate failures for retry. 25 authenticated/profile/worker/batch tests passed. GitHub backend/frontend checks passed, Vercel deployment completed, and Render health confirms live revision 5379db8a55c9fc1232ebd1694a37dc67e0aff84b.
- POS KOT mutations now store the AdminCore order-change job and its sync log inside the same PostgreSQL transaction as ticket/order changes. Optional tx support added to notifyChange/log persistence; transaction failures propagate instead of being swallowed. Existing nontransaction callers retain prior behavior. No outbound network call occurs in the transaction.
- PostgreSQL regression verifies correct tenant/business/order/kitchen payload and rollback of both queued job and log. Final POS deploy check passed. Prior frontend final build passed and frontend unchanged this turn. POS commit 52e03859c2e6c2737ff06d5c35e97cd0b0b45271 pushed to origin/master including previous billing/kitchen fixes. Final GitHub backend/frontend checks both succeeded and Vercel deployment succeeded. POS readiness returns true but does not expose revision, so exact backend rollout is unverified.
- Hosting secret rotation still requires Render environment access; no Render connector/credentials present. Live AdminCore still reports production_config_ok false with "Replace the development POS bridge key in both production services". Public health and GitHub checks are read-only; do not claim authenticated end-to-end sync verification from health alone. Latest checkpoint changes after push are documentation only.

### Kitchen workflow development (latest)

- Added kot-workflow.js for permitted status progression and aggregation of mixed ready/served/rejected items. General status endpoint delegates to actual actions so timestamps, items and order status change together. Invalid jumps, missing item IDs, unauthorized item actions, edits to closed tickets and blank rejection reasons are rejected. Completion replay retains original history.
- Chef screen adds acceptance queue, per-item accept/prepare/ready, station filter, elapsed/target time and SLA warning, reason-based rejection, and ticket history. Waiter screen now fetches the actual KOT ready queue and calls complete-service; legacy bill UI remains. Both screens show request errors and disable in-flight actions. Browser/device acceptance is still unverified.
- QR ticket creation now checks restaurant approval inside the ticket transaction; a pending QR order cannot bypass approval through direct KOT creation. PostgreSQL/HTTP regressions pass for this, full item-to-service progression, closed/reverse action rejection, role restrictions, ready queue HTTP response, mixed service statuses, and active overdue alert.
- Final backend deploy suite passed after QR guard (exit 0). Final frontend production build including rejection UI passed (session 57455 exit 0); earlier build 2265 also passed. PostgreSQL workflow suite and git diff --check passed. No command remains running. Logs are backend/logs/frontend-build-latest.log and production-flow-latest.log. Changes remain local/uncommitted; no browser or device acceptance claimed.
- Next: finish build verification, then cashier settlement (current backend auto-opens shifts on reads, lacks history UI, needs atomic closing/collection coordination). Continue cross-project sync verification; KOT changes still need durable AdminCore order notification coverage. Full 13-part tracker remains scope, no production sign-off.

### Invoice edit and legacy permission audit (latest)

- Shared updateInvoice now allows only customer/contact/notes/kitchen edits and server timestamps; feedback initialization is an explicit internal option used only after legacy creation. Financial, audit, ownership, outlet, order and currency edits fail with 409 through both legacy and module routes.
- General invoice edits now take the same PostgreSQL advisory transaction lock as payments/refunds/voids. They preserve stored totals and merge current metadata inside the lock. Removed the old recalculation/item-replacement path from issued-invoice edits; no route/module was removed.
- Issued invoices cannot be hard deleted; use void approval to retain audit records. Legacy bill creation/edit/deletion now enforces billing permission; kitchen status writes require Owner/Manager/Chef/Waiter.
- Real isolated PostgreSQL regressions passed, including concurrent payment vs kitchen edit, unchanged invoice totals/number, wrong-tenant rejection, audit retention, HTTP financial-field rejection through three routes, successful normal kitchen update, and four denied legacy writes for a cashier without grants. Fixtures cleaned. AdminCore's 24 authenticated/profile/worker/batch tests passed again (mock DB/POS, not live).
- Backend deploy check passed after the final legacy permission changes. These changes and preceding payment/void/manual-sync changes remain local and uncommitted.
- KOT mutation now re-reads inside the same order/ticket advisory lock used by ticket creation; simultaneous item updates retain both states and both audit entries. Ticket re-provisioning preserves prior preparation timestamps. PostgreSQL regression passed for both cases. Full backend deploy check passed after this last KOT change (exit 0); no command remains running.
- Next: verify final backend suite, then audit KOT/QR transitions and cashier settlement. Keep full release tracker scope; production bridge-key rotation and live provider/hosting verification remain unresolved. User has not supplied a specific visible issue yet.

### Visible-issues follow-up / payment transitions

- User says visible problems remain. An async question asks for screen/action/actual/expected; no answer received yet. Continue known work without relying on them to rediscover tracker gaps.
- Confirmation now rejects failed/cancelled payments, blank/nonstring refs, refs already used on another payment, and overpayment. Repeating an already-confirmed identical reference preserves its audit fields; changing reference is rejected. PostgreSQL regression passed.
- Void request/approval now uses the same advisory-lock transaction as payment/refund changes, preserves amounts, requires a nonblank reason, pending approval and Owner/Manager authority, and prevents void while funds remain unrefunded or payments pending. Rejecting a void preserves prior bill status. Legacy generic update path still requires broader metadata-write audit; do not assume every route is covered.
- Added concurrent void-vs-cash test: exactly one operation succeeds. Production DB suite passed. Void notifications retain previous `updated` action for AdminCore compatibility.
- Full backend deploy check rerun started; check running session and backend/logs/deploy-check-latest.log for final status. Changes remain local. Next investigate generic invoice metadata overwrite/delete permissions, then KOT/QR-to-settlement acceptance; incorporate user's visible issues if supplied.

### Latest workflow continuation

- AdminCore manual `POST /users/{id}/sync-pos` now returns 202 and uses the existing durable profile queue for all assigned businesses. It no longer calls POS directly or implicitly syncs just the first business. Existing active/retrying states are returned honestly. UsersPage toast no longer reports synced for running/retrying jobs. 24 AdminCore authenticated/profile/worker/batch tests passed; UsersPage JSX parsed. New code is local, not yet pushed.
- POS invoice creation now uses `normalizeSubmittedPayments` to reject invalid/negative/excess payments and override client-confirmed non-cash statuses to pending_confirmation. Additional bill payments trim method names and treat all non-cash methods as pending. Historical stored payment normalization remains unchanged. `submitted-payment-tests.mjs` and production DB flows passed, including actual forged-UPI invoice and overpayment rejection. New unit suite wired into deploy:check.
- Full POS deploy:check passed exit 0 (session 60372), including smoke and payment security checks. git diff --check passed with line-ending warnings. No command remains running. No provider payment or real customer invoice was created; isolated regression fixtures cleaned by suite.
- Next implementation: verify all confirmation/void/refund transitions (including canceled payments and refund-vs-void races), then KOT/QR-to-settlement acceptance flow. AdminCore public/protected scope and provisioning queues remain part of full release tracker. Production bridge-key rotation still requires hosting configuration access. No competitor-parity claim or production sign-off.

### Review follow-up: 2026-09-13

- Published AdminCore improvement as commit `4edd31f` on origin/master. Push succeeded. Exact live rollout/CI verification is in progress; do not repeat earlier pending-commit statement below as current status.

- User supplied ten concrete sync/reliability findings. See `docs/SYNC_REVIEW_2026-09-13.md` for each finding's current evidence and limits. Existing current code already queues profiles/user creation, paces requests, honors Retry-After, and resumes checkpoints; don't rewrite those as missing.
- Added AdminCore provisioning progress callback: saves current_step, business pos_provisioning_step, and bounded last-100 history entries (step/status/attempt/time). Completed checkpoints remain unchanged. Business list shows readable current-step labels. New failure regression checks owner-step retry history; new rate-gate regression proves follow-up requests are suppressed after 429 and uses Retry-After value 7.
- 23 AdminCore authenticated/profile/worker/batch tests passed; changed JSX parsed. New AdminCore source changes pending commit/push as of this checkpoint. No command running.
- Live POS readiness 200/true. AdminCore first health timed out, retry returned 200 at revision 4f8394c; production_config_ok remains false due development bridge key. No hosting-secret access; must rotate same key in both services. No authenticated live customer-data mutations made.

### Deployment verification after continuation

- Both pushes SUCCEEDED: POS master `ac1aab7477699bed09e5a095a89ed998465c84f2`; AdminCore master `4f8394c9a839d436b6a5d50cf8c6c8dfa052197d`. Do not repeat the old claim that all changes are unpushed.
- GitHub checks for both commits show backend/frontend success. Both Vercel production deployments report completed successfully.
- Render AdminCore `/api/health` initially timed out, then returned 200 with revision exactly `4f8394c9a839d436b6a5d50cf8c6c8dfa052197d`. Render deployment of this commit is confirmed.
- Render POS `/health` and `/health/ready` returned 200; readiness true. Its health response has no revision, so exact deployed POS commit cannot be independently verified from it. No Render deployment checks appeared in GitHub (only Vercel records).
- IMPORTANT LIVE FINDING: AdminCore health returned `production_config_ok: false` with error `Replace the development POS bridge key in both production services`. No secrets printed. Production shared-key rotation on BOTH Render services remains required. No Render CLI, connector or API credentials were available in this context; hosting configuration was not changed. Do not claim secure production sign-off.
- Earlier instruction to skip live verification was superseded for this deployment by the explicit push-to-Render request and continuation. No running commands remain. This checkpoint update is local and intentionally not another application deployment.

### Deployment request: 2026-09-12

- User explicitly requested pushing both projects to Render. Both Git remotes fetched successfully and local HEAD matched origin/master before committing: POS `techviswa/pos_v1` at 52d9ae2; AdminCore `techviswa/tsk-admin-v1` at e2f0069.
- POS deploy:check passed exit 0 on the current source. AdminCore worker plus authenticated ASGI suite passed 11 tests. No frontend source changes in this batch.
- Preparing commits containing only source, tests, package manifests/lockfile and documentation. No env files, local backups, logs, dependencies or build output included. Push and Render status must be verified after committing; do not infer a successful deployment from a Git push alone.

### Latest default-outlet continuation

- AdminCore `backend/default_outlet.py` now creates automatic outlets via insert-only upsert on stable Mongo `_id=default-outlet:{business_id}`; concurrent loser reuses the persisted winner and cannot overwrite its ID/settings. `server.py` default-outlet branch uses the helper and audits creation only for the inserter. Existing outlet lookup/identity remains intact. Existing historical duplicates are not merged/deleted.
- Four helper unit tests pass: stable key/insert-only behavior, concurrent duplicate-key winner reuse, unrelated uniqueness failure, wrong-business rejection. These use mocks, not a live Mongo race test.
- Reviewed and ran current AdminCore `test_production_authenticated_sync.py`: six ASGI tests pass (mock DB/POS) for own/wrong scope, tenant data access/queue restrictions, unauthenticated rejection, async user/profile provisioning, and checkpoint resume. No real production server contacted.
- Older extracted-function provisioning suite updated to inject the new persistence helper; nine tests pass. Next: live isolated Mongo concurrency testing if local Mongo is available, review provisioning queue history/leases, then billing/KOT/QR workflow acceptance per PRODUCTION_RELEASE_TRACKER.md. No running commands, push or deployment at checkpoint.

### Latest continuation: 2026-09-12

- Read `docs/PRODUCTION_RELEASE_TRACKER.md` first alongside this checkpoint. It now preserves the entire 13-part scope, per-area evidence/gaps, user-deferred items, external checks, and continuation protocol. No area has been signed off. User expects continuation of the full scope, not isolated fixes treated as completion.
- Current AdminCore has newer `pos_retry.py`, snapshot/event worker and additional tests added outside the earlier checkpoint. Preserve these changes; review actual code before edits.
- Reproduced snapshot freshness bug with a failing test: recently failed snapshot returned failed rather than being requeued. Changed AdminCore `backend/pos_sync_worker.py` so freshness reuse requires status synced and a recent finished_at. Nine worker tests now pass, including failure requeue and successful fresh reuse (mock Mongo; not live atomicity verification).
- Updated POS `backend/scripts/admincore-worker-tests.py` to load sibling AdminCore imports from the supplied backend path. No live deployment, commit or push in this continuation.
- Reviewed the current AdminCore `test_pos_sync_worker.py` (mock collection/processor only) and ran it: five tests passed covering recent snapshot reuse, concurrent active-job reuse, retry headers, rate-limit cooldown and retry exhaustion.
- Next: inspect AdminCore `test_pos_sync_worker.py` and `test_production_authenticated_sync.py` before running, assess side effects, then audit default-outlet creation/provisioning concurrency and cross-project identity/deletion propagation. Refresh tracker as evidence accumulates. Earlier SMTP config, dependency advisory and device/live limitations remain. No running command at this checkpoint.

### Latest email/invite continuation

- Added nodemailer and `auth-mail.js`: SMTP with required TLS, fixed configured HTTPS frontend links, timeouts, sender acceptance checks; reset/invite flow sends when configured. Production reset rejects missing email configuration. SMTP settings are documented in DEPLOYMENT.md; no credentials supplied and no real email sent. Invites preserve copy-link behavior when mail is absent. Mail is synchronous; durable encrypted delivery/retry remains a gap.
- Fixed invitation account takeover: existing users can no longer be password/role-overwritten through acceptance; Manager cannot create Owner invitations; unknown roles rejected; newly invited users receive persisted default role permissions. `invite-security-tests.mjs` passes actual DB takeover/escalation/grants checks. Expected P2002 is logged by Prisma for the duplicate-account test.
- `auth-mail-tests.mjs` passes links, invalid HTTPS/config, and rejected-recipient tests with mocked transport. Both tests added to deploy:check. Production reset response now uses the same accepted payload for found/unknown emails; timing/SMTP error enumeration and request rate limits still need review.
- Installed dependency updates: nodemailer 10.0.3, morgan 1.12.0, body-parser 1.20.8; Express qs overridden to ^6.16.0. Latest npm install reports 3 high findings through Prisma -> @prisma/config -> deepmerge-ts 7.1.5 (same advisory propagated). No forced Prisma downgrade performed. Advisory https://github.com/advisories/GHSA-ggr8-5vv4-36mx describes recursive object graph exhaustion; plain JSON alone does not cause it.
- Full deploy:check passed after final qs override, exit 0 (session 7065). Smoke, new auth/invite/email tests and existing sync/payment tests passed. git diff --check passed with Windows line-ending warnings. No command remains running from this continuation. Earlier live-check skip remains, no push/deployment performed.

### Latest continuation: 2026-09-11

- Follow-on: staff authorization now treats persisted permissions as authoritative instead of restoring role defaults after revocation. Owner retains administrative default permissions. `permission-revocation-tests.mjs` verifies 403 for revoked/partial staff grants, successful explicit grants/owner access, and 401 for anonymous users.
- Added permission, bridge-context, token-security and startup-recovery tests to deploy:check. Initial smoke failed because conflicting request IDs now return 400 instead of 403; expanded it into separate conflict (400) and consistent-but-invalid tenant mapping (403) cases for staff/products/outlets.
- Updated deploy suite printed all tests passed including smoke and final `Deploy check passed`. PowerShell returned exit 1 from stderr redirection of Prisma's deprecation warning; `backend/logs/deploy-check-latest.log` shows NativeCommandError for that warning, with no failed test in the final run. Use cmd-owned redirection for subsequent runs. Production DB flow tests also passed. No deployment or frontend changes in this follow-on.

- User reaffirmed responsibility for missing production features, especially cross-project sync and preventing data leaks. Prior instruction to skip live verification still applies.
- IMPORTANT: working tree was clean at resumption, HEAD `52d9ae2` (Make POS production seed safe). Files contain additional tenant-scope fixes beyond the older checkpoint. Do not assume all historical changes below remain uncommitted or unchanged; inspect current state.
- Added `bridge-context.js` and integrated it in AdminCore-facing staff/product/outlet controllers. Conflicting snake/camel aliases or identity headers and invalid types now fail before a write; existing business/tenant DB-pair validation remains. `bridge-context-tests.mjs` passed.
- Reset/invite tokens now store SHA-256 digests instead of usable tokens for new records. Existing raw 64-hex links remain compatible until expiry; stored digests cannot be replayed as bearer tokens. `auth-token-security-tests.mjs` passed digest storage, wrong-type rejection, concurrent single redemption and legacy-link compatibility.
- POS production DB flow suite passed after these changes. No frontend changes or deployment in this continuation. Full security audit, feature completion, legacy credential cleanup and production readiness remain unfinished.

### Latest reliability continuation

- User answered "skip this" to production URLs/hosting project question. Skip live deployment verification; continue local implementation. Do not represent this as live validation or ask the same question again.
- Added `backend/scripts/backup-database.mjs`; it successfully generated a local PostgreSQL custom archive under ignored `backend/data/backups/` and checked table entries with pg_restore. Credentials are passed via child environment. Documented usage and limitations in DEPLOYMENT.md. Restore drill, off-host production storage, retention and scheduling are NOT completed.

- POS server now retries failed initial database connections every five seconds; shutdown cancels the retry timer and stops job polling before disconnecting. `startup-recovery-tests.mjs` executes the actual startup code with mocked dependencies/timers and passes transient failure recovery and shutdown checks.
- AdminCore `/pos-bridge/config` now accepts the existing validated bridge-key headers that POS health sends; browser requests still require a session. Three actual-function auth tests pass (`admincore-health-tests.py`). POS HTTP/retry regression tests also pass.
- Corrected stale SQLite and in-memory-queue claims in `DEPLOYMENT.md` and documented current readiness behavior.
- Asked asynchronously for actual POS/AdminCore production URLs and Render/Vercel project identifiers. No answer yet. No push or deployment performed. Full production checklist remains open; continue legacy credential cleanup, database backup/restore process, queue concurrency, then the remaining functional areas.

### Latest continuation: 2026-09-07

- Manual AdminCore `POST /businesses/{business_id}/provision-pos` now queues the durable provisioning job and returns HTTP 202 with `pos_provisioned: false` and `pos_provisioning_job`. It rejects an unconfigured bridge with 503. It no longer awaits the full POS chain or records a premature synced audit entry.
- AdminCore `frontend/src/pages/BusinessesPage.js` retry toast now says queued and asks the user to check business status.
- Default-outlet synchronization now rethrows HTTP failures in both existing/new outlet branches, allowing provisioning retry/error handling to see them rather than falsely succeed.
- Nine actual-function provisioning tests and seven worker tests passed. The changed AdminCore frontend JSX parsed successfully; no complete AdminCore frontend build or deployed integration test was performed in this continuation.
- Remaining immediate work: legacy credential cleanup, queue enqueue/claim concurrency and status history, default-outlet creation concurrency, bridge-config authentication. Previous existing-credential migration and live deployment limitations remain. Changes are local; no push or deployment.

### Superseding update: resumed with user authorization

AdminCore editing now succeeds; the earlier usage-limit rejection is no longer blocking these edits. Applied to `backend/server.py`: explicit target business for owner provisioning with membership check; removed the business-list preflight; validate returned business/tenant identity before saving the mapping. Added `backend/pos_passwords.py` for POS-compatible PBKDF2 hashes in new provisioning jobs, removed plaintext credentials from new business records/manual retry updates, aligned owner minimum length to 8, and prevented creating an AdminCore login from a queued hash. Existing MongoDB plaintext records have NOT been migrated. Manual retries remain synchronous; default-outlet failures and bridge config authentication still require fixes.

Verification: 5 tests against extracted actual AdminCore provisioning functions passed, 7 worker tests passed, POS production DB flow tests passed. `admincore-password-tests.mjs` verifies Python-generated hashes using the actual POS Node password verifier. No Git push or live deployment performed. The historical rejection details below describe the earlier state, not a current blocker.

Automatic approval review rejected the proposed AdminCore password/provisioning patch because the account usage limit was reached. The rejection explicitly prohibited bypassing it. On resumption, read-only verification confirmed:

- `AdminCore/backend/pos_passwords.py` does **not** exist.
- `server.py` still persists `pos_owner_password` and plaintext queued owner credentials.
- `push_admin_user_to_pos` still chooses the first entry of `business_ids` rather than an explicit provisioning target.
- Tenant provisioning still prefetches the businesses list before POSTing to POS.

These fixes were proposed but **not applied**. Do not describe them as done.

## Changes already on disk

POS has uncommitted changes in deployment, Prisma schema/migrations, sessions, sync, tenant settings, billing, KOT, inventory, printer scope, frontend error handling and regression scripts. Inspect `git status` and `git diff`; do not reset or replace the working tree.

New migrations `20260906_production_persistence` and `20260907_schema_alignment` were applied locally. The alignment migration initially rolled back on an existing constraint; it was corrected before successful application. Do not rewrite these now-applied migrations. Isolated-schema verification passed afterward.

AdminCore changes already applied:

- Removed business-name fallback matching in `provision_admin_business_to_pos`.
- Stopped reporting an existing mapping as success after a failed provisioning POST.
- Added `backend/pos_sync_worker.py`: MongoDB-backed event receipt, processing leases and retries.
- `/pos-bridge/sync-status` queues stable event IDs rather than awaiting the full import.
- Added `/pos-bridge/change-jobs` status endpoint and started the sync worker on startup.
- Provisioning worker now uses a conditional claim before executing a job.

The AdminCore queue changes still require dedicated unit/integration verification. Existing default-outlet error swallowing and password persistence remain review findings.

## Verification evidence

- POS `production-flow-tests.mjs`: passed after the financial/printing refactors. Covers idempotent provisioning, mapping conflict, DB sessions, concurrent invoice numbers, concurrent payments/refunds, duplicate KOT creation, printer claims/scope and durable job processing.
- POS `admincore-reliability-tests.mjs`: passed; covers failed HTTP request, timeout, retry and exhaustion.
- POS `verify-migration-history.mjs`: passed on an isolated temporary schema. It creates and removes only its own randomly named schema.
- POS deploy/smoke checks passed on an earlier revision. The existing smoke suite uses a development fallback login, so it is not sufficient production-auth evidence.
- POS frontend production build passed before the latest frontend changes; rerun for the final revision.
- AdminCore Python syntax passed before the latest queue edits; rerun all Python syntax checks.
- No live deployments, physical phone tests, physical printer tests, real gateway tests or backup restore drills have been completed.

## Next actions in order

### Latest continuation: 2026-09-06

- Reproduced an exhausted POS job being delivered again after a worker crash with a failing regression (delivery count 3 instead of 2).
- Added a retry-limit guard in `backend/src/services/jobs/durable-job-queue.js`. The regression now passes; a second case confirms an expired lease with a remaining attempt still completes.
- Added `backend/scripts/admincore-worker-tests.py`. Seven isolated async tests pass against the actual AdminCore worker module: stable event receipt, cross-business event conflict, idle worker, successful lease-scoped completion, partial-import retry, terminal failure and exhausted crash recovery. These mocks do not verify MongoDB atomicity or live integration.
- Reran POS production DB flow tests: passed. Reran backend `deploy:check`: passed (development smoke-login limitation still applies). `git diff --check` passed with Windows line-ending warnings.
- Frontend production build completed successfully (exec session `78780`, exit 0). It emitted stale Browserslist data and Node deprecation warnings, with no compilation errors. No build process remains pending from this continuation.
- No new AdminCore edits were attempted; the previously rejected password/provisioning patch remains unapplied. No live deployment performed.
- Syntax checks also passed for all 148 JavaScript modules under POS `backend/src` and `backend/scripts`, and all 3 Python files under AdminCore `backend`. Python was parsed without generating bytecode or modifying AdminCore.

1. Save/update this checkpoint as work progresses. Check for partially running commands before restarting installs or builds.
2. Verify current syntax and rerun targeted POS regressions. Add tests for the AdminCore queue and changed integration contracts.
3. When approval review permits the original action, finish the rejected AdminCore patch: stop storing plaintext owner credentials, pass an explicit business to owner provisioning, eliminate the unnecessary preflight export, and verify returned business/tenant IDs. A proposed approach is a standard-library PBKDF2 hash compatible with POS, persisted only after the AdminCore owner is created; do not accidentally hash that value as the AdminCore login password.
4. Fix default-outlet sync error swallowing, align password length rules, make manual provisioning retry asynchronous, and accept the bridge key on the AdminCore config/health endpoint.
5. Finish the cross-project review in `PRODUCTION_REVIEW.md`, including prior change compatibility. Do not confuse automated inventory coverage with a completed line-by-line or runtime review.
6. Address public payment-webhook trust, legacy file-data migration, remaining in-memory stores, invoice/shift edge cases, KOT transitions, QR race conditions, reports/export correctness, mobile and printer agent flows.
7. Run final builds and full tests; verify deployment only with the actual live service configuration and access.

## Known pending dependencies and cautions

- Live URLs, payment provider and printer models were requested asynchronously but not supplied. Source defaults include `pos-v1-fwjm.onrender.com` and `tsk-admin-v1.onrender.com`; do not assume these identify the user's current live deployments. Web access to the POS URL failed and is not proof of its server state.
- An earlier npm install for nodemailer/pdfkit/exceljs was interrupted or stalled. They were not present in backend/package.json on resumption. Check before retrying.
- `backend/migration-history-diff.sql` is a generated review artifact, not a pending migration to apply blindly.
- `backend/src/services/jobs/job-queue.js` still includes the unused legacy in-memory class; the exported instance uses DurableJobQueue. Do not remove code just to reduce line count.
- The user is concerned about removed lines. Explain behavior-preserving replacements and test the old output contracts; correct or revert unjustified changes.
- `DEPLOYMENT.md` contains stale wording from the first pass; update it to match the final configuration.

## Review documents

- `docs/PRODUCTION_REVIEW.md`: findings and release gates.
- `docs/PROJECT_INVENTORY.md` and `docs/project-review-inventory.json`: automated first-party inventory, initially 296 POS files and 85 AdminCore files. Refresh after substantive changes.
