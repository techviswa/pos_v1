# Tenant isolation

The POS uses a shared PostgreSQL database with application-level tenant isolation
and optional locally activated PostgreSQL row-level security (required in production).
The Prisma client exported by `backend/src/database/prisma/client.js` is the only
client application services should use. See [RLS_DEPLOYMENT.md](RLS_DEPLOYMENT.md)
for the new RLS migration, separate runtime roles, activation and direct SQL tests.
The original database provider and `DATABASE_URL` are preserved.

## Request boundary

Each HTTP request gets a separate asynchronous context. Private routes bind it
to the business and tenant of the authenticated session. Client headers and body
fields cannot select another business. AdminCore bridge credentials remain a
privileged platform capability: bridge scope is resolved and validated by the
existing bridge guards. Keep that key outside browsers and business accounts.

Public QR and feedback requests derive context from the verified QR or feedback
token. QR menus and product photos are intentionally public customer content.
Knowing a public menu link is not permission to access staff APIs or other business
records. Payment, printer-agent, marketing webhook and realtime-ticket endpoints
retain their dedicated capability/signature checks and isolation tests.

## Database boundary

The shared query guard filters business-owned models, Business itself, and child
models through their owning relation. It checks nested write references and nested
read projections, filters relation lists and counts, and prevents changing a
record's business. Bulk operations, aggregates, upserts and interactive transactions
keep the same business restriction. New schema models must have a tenant policy
or appear in the explicit system-model policy list; the boundary test checks this.

JSON state documents have business-scoped namespaces or an explicit business owner.
Auth sessions, reset/invitation tokens, sync logs, invoice/KOT sequences and durable
jobs have separate explicit scope rules. Role/permission definitions are a shared
source-controlled catalogue: a business request may materialize canonical defaults
but may not rewrite or delete global definitions.

Foreign-reference checks use a separate connection pool capped at two connections
to the same database. This avoids waiting on the pool held by concurrent interactive
transactions. The exported client's disconnect closes both pools, and both use
the existing Decimal-to-number conversion. Include these connections in production
database capacity planning.

Unsafe raw SQL is refused in bound business contexts. With RLS activated, all tenant
SQL additionally runs on the restricted database role. Existing parameterized SQL
for locks and stock updates still needs explicit business predicates where it
reads or mutates business data; a query extension cannot infer arbitrary SQL intent.
Maintenance/provisioning code outside a bound context is privileged and must not
be exposed as a business-controlled query interface.

## Jobs, persistence and browser state

Durable job handlers run with the business resolved from their stored payload;
an invalid business/tenant pair fails the job. System jobs without a business stay
in the explicit system context. Marketing scheduler and webhook workers retain
their per-business claim, signature, ownership and accounting checks.

New report schedules and client-sync events are business-partitioned database state
documents, rather than shared writable JSON files. Legacy file records are read
only after filtering by their owning business/tenant. Client-event idempotency is
namespaced by business and handles concurrent duplicate submissions.

The browser GET cache and table-management cache include the tab session identity.
Private authenticated responses use `Cache-Control: private, no-store`. Offline
till copies and queued bills retain their existing user/business partitions.
Database failures do not substitute shared sample bills, inventory or product costs.

## Verification and release

Run the full backend gate and frontend checks against a test database:

```powershell
cmd /c npm --prefix backend run deploy:check
cmd /c npm --prefix frontend run build
cmd /c npm --prefix frontend test -- --watchAll=false --runInBand
```

The deploy gate includes `tenant-boundary-tests.mjs` and
`tenant-integrity-audit.mjs`. Boundary tests exercise model policies, foreign keys,
nested writes, projected relations, counts, transactions, cache context, parallel
tenants, spoofed identity headers, live reads/exports and foreign-ID mutations.
The read-only integrity audit checks existing cross-business foreign-key links and
fails without changing records if it finds any. Security, lifecycle, account-policy,
payments, payroll, marketing, bridge, public QR and production-flow suites remain
part of the same gate. Test fixtures use unique temporary businesses and clean up.

Production startup now refuses the configuration issues reported by
`getProductionConfigIssues`, including default owner credentials, unrestricted
CORS, short enabled bridge keys, short JWT/encryption secrets and default database
credentials. Supply the real secrets and URLs described in `DEPLOYMENT.md`.

Deploy to staging with a separate database before inviting independent businesses.
Use HTTPS, a least-privilege application database role, restricted secret access,
off-host backups and a verified restore procedure. An external penetration test
and production load test provide assurance beyond these repository tests. Passing
the tests is evidence for the covered boundaries, not a guarantee of zero defects.

Implementation references: [Node asynchronous context](https://nodejs.org/api/async_context.html)
and [Prisma v6 query extensions](https://www.prisma.io/docs/orm/v6/prisma-client/client-extensions/query).
