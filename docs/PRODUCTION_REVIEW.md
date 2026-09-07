# POS and AdminCore production review

## Product target

A multi-business restaurant operating platform with the breadth to grow toward Petpooja, Toast, GoFrugal and Odoo. Competitor names describe the ambition, not completed feature parity.

AdminCore owns business identity, subscriptions, entitlements, provisioning and platform administration. POS owns restaurant transactions: orders, invoices, kitchen work, stock movements and cashier settlement. Operational records must have one authoritative owner; imported copies must not silently become an independent ledger.

## Review status

Both first-party source trees are being inventoried. Detailed review and regression testing are ongoing. The inventory is not a line-by-line verification claim. No live Render/Vercel deployment has been performed. No physical printer or phone testing has been performed.

## Existing changes under review

| Change | Purpose | Evidence / limitation |
| --- | --- | --- |
| PostgreSQL deployment and migration alignment | Remove stale SQLite configuration; reproduce Prisma schema from migrations | Local migration and isolated-schema tests passed; live DB unverified |
| Durable sync jobs, tenant settings, sessions and printer jobs | Preserve operational state across restarts | Targeted database tests passed; legacy file-data import still required |
| Payment/refund transaction helper | Prevent concurrent updates losing payments or exceeding refundable amount | Concurrent-payment and refund tests passed; broader settlement review ongoing |
| Shared KOT creation | Stop duplicate creation logic and duplicate tickets | Concurrent creation tested; complete transition/printing review ongoing |
| Scoped printer operations and tenant endpoints | Prevent one business accessing another business's data | Scoped printer test passed; HTTP permission matrix being expanded |
| Frontend fallbacks | Recover from render/network failures | Earlier production build passed; latest changes require a fresh build |

## Confirmed review findings

1. AdminCore provisioning used name matching as an alternative to stable IDs. Equal restaurant names must never link unrelated tenants.
2. AdminCore could suppress a provisioning error and report an existing mapping as success.
3. POS notifications time out in five seconds while AdminCore performs a synchronous import in that callback. Receipt and processing must be separate, with durable status/retry history.
4. Invoice preview still used the old daily counter after final numbers moved to a database counter. Preview must use the same source and remain explicitly provisional.
5. My payment refactor initially omitted the derived gateway-status update. Restore and regression-test that output contract.
6. My printer refactor narrowed default-target matching. Preserve the original default routing behavior while enforcing business scope.
7. SaaS role checks did not compare requested business ID with authenticated business ID on tenant detail/usage endpoints.
8. AdminCore Express handlers used async functions without the project's async error wrapper.
9. Public payment webhooks currently trust payloads without provider verification. This is a release blocker.
10. Some functions still store data in files/memory: payment intents, offline events and scheduled reports. These require persistence or an explicit disabled status, not a production-ready label.

## Release gates

- All migration, API, permission, concurrency and browser tests must pass on the final revision.
- Test provisioning and sync across both apps, including duplicate requests, worker restarts and unavailable backends.
- Verify production URLs, secrets, hosting settings and the deployed PostgreSQL schema.
- Verify backup restoration into a separate database.
- Verify actual receipt/KOT printers and mobile screens.
- Configure and test the chosen payment and email providers. Never interpret client-supplied payment status as provider confirmation.

The original thirteen-area production checklist remains open until each item has evidence or an explicit external dependency. This document is an ongoing review, not a completion certificate.
