# Resume checkpoint — read this before continuing

## User authorization and objective

The user authorized reviewing and improving both projects toward a production-ready multi-business restaurant platform comparable in scope to Petpooja, Toast, GoFrugal and Odoo. The original thirteen-area production checklist remains the scope. They specifically asked for reliable continuation after credit limits or interruptions. Do not restart, discard existing work, or claim full completion.

POS: `C:\Users\viswa\OneDrive\Desktop\viswa pos table error`

AdminCore: `C:\Users\viswa\OneDrive\Desktop\pos admin panel - Copy\pos admin panel not 1drive`

Follow POS `AGENTS.md`. No AdminCore AGENTS.md was found. User permission includes AdminCore edits and necessary DB configuration changes. No subagents have been authorized. Preserve user data, local secrets and the current architecture.

## Exact interruption

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
