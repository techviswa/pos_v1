# Resume checkpoint — read this before continuing

## User authorization and objective

The user authorized reviewing and improving both projects toward a production-ready multi-business restaurant platform comparable in scope to Petpooja, Toast, GoFrugal and Odoo. The original thirteen-area production checklist remains the scope. They specifically asked for reliable continuation after credit limits or interruptions. Do not restart, discard existing work, or claim full completion.

POS: `C:\Users\viswa\OneDrive\Desktop\viswa pos table error`

AdminCore: `C:\Users\viswa\OneDrive\Desktop\pos admin panel - Copy\pos admin panel not 1drive`

Follow POS `AGENTS.md`. No AdminCore AGENTS.md was found. User permission includes AdminCore edits and necessary DB configuration changes. No subagents have been authorized. Preserve user data, local secrets and the current architecture.

## Exact interruption

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
