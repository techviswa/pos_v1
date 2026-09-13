# Review of the ten reported sync problems

Evidence: current source in both projects; 23 AdminCore tests (authenticated ASGI requests with mocked dependencies, workers, profile recovery, sequential batches); unauthenticated live health checks. No customer records were created or changed in production for this review.

| Finding | Current conclusion |
| --- | --- |
| 1. POS 429 / 300-second pause | AdminCore already has a shared per-process paced HTTP gate and Retry-After handling. New test proves a 429 suppresses the next outbound call and respects a 7-second header, rather than always waiting 300. No production 429 was reproduced. Request-budget behavior across multiple replicas remains unverified. The checked-in POS app has no rate limiter that explains this reported 429. |
| 2. Provisioning remains pending | Durable job claims, saved business/owner checkpoints, stale-job recovery and identity verification exist. Newly added current-step tracking and bounded history make running/retry failures inspectable. Actual production job records were not available. |
| 3. Forms depend on immediate POS | User creation and profile changes are already queued; authenticated tests verify 202 and no immediate POS call. Other direct bridge product/outlet operations still require separate review. |
| 4. Full resource sync | Tests cover scope rejection for products/bills/payments/customers/inventory/reports/staff-shifts plus own-scope product export. This is NOT end-to-end ledger validation for every resource/business. |
| 5. Confusing status | Fixed another gap: durable current_step and a last-100-event history with attempt numbers. Business list now labels business, owner, outlet, verification and completion. Full job-history UI and failure-detail disclosure still need work. |
| 6. Retry workflow incomplete | Rate-limit attempts are preserved, terminal failures stop, profile jobs checkpoint completed businesses and batches are sequential. Tested locally; durable cross-replica throttling and prolonged-outage acceptance remain open. |
| 7. Tenant scope | Authenticated tests deny reading/queueing another business and reject wrong POS tenant responses; bridge identity validation exists. Complete outlet and all-resource ownership matrix is not yet proven. |
| 8. Deployment verification | POS /health/ready returned 200/ready true. AdminCore /api/health timed out once, then returned 200 at deployed revision 4f8394c. New status/history changes are separate local changes until pushed/deployed. |
| 9. Backend availability | First AdminCore request timed out; retry succeeded. This cannot distinguish sleeping service from another transient delay without hosting logs. POS readiness passed during review. |
| 10. Frontend messages | New readable setup-step labels added and JSX parsed. Existing technical error text remains visible in the business administration screen; full audience-specific error design is unfinished. |

## Confirmed hosting security blocker

AdminCore's live health reports `production_config_ok: false` and `Replace the development POS bridge key in both production services`. Both Render services need the same strong production secret. No Render configuration credentials/connector are available here, so no secret rotation was performed. Do not describe this as fixed through a code push.

## Verification command

From AdminCore backend: `python -B -m unittest test_production_authenticated_sync test_pos_sync_worker test_pos_profile_updates test_pos_sync_batch` passed 23 tests. JSX parse passed for BusinessesPage. These tests use mocks and do not prove live Mongo concurrency or actual provider delivery.
