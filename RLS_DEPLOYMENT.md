# PostgreSQL row-level security

Local activation verified on 2026-10-25: `pos_system_runtime` and
`pos_tenant_runtime` are configured, all 62 application models are protected,
and the 61 direct database isolation checks passed against the local database.
The backend was restarted with those credentials and `/health/ready` passed.
The complete backend regression suite reached `Deploy check passed`; its saved
output is `backend/logs/rls-activation-deploy-check.log`. The PowerShell output
capture returned status 1 after treating native stderr warnings as errors, even
though the underlying runner completed every check and printed its success marker.
The administrator credential is excluded from the application environment and
retained only in ignored `backend/data/admin-recovery/postgres-admin.env` for
local administrator recovery. Keep this file private and outside deployment.
`DATABASE_URL` remains unchanged. A pre-activation database backup is under
ignored `backend/data/backups/`. This does not activate RLS on a separate hosted
database; repeat deployment setup and verification there.

RLS is implemented in migration `20261024090000_tenant_row_security` and the Prisma
runtime. It is active only after the migration and both runtime roles are installed
and `SYSTEM_DATABASE_URL` / `TENANT_DATABASE_URL` are configured. Code presence or
an application-level isolation test alone does not prove database activation.

## Credentials and responsibilities

| Connection | Purpose | Privileges |
| --- | --- | --- |
| `DATABASE_URL` | Deployment migrations, owner fixtures, backups | Existing table owner; never expose to browsers |
| `SYSTEM_DATABASE_URL` | Login/session lookup, public capability resolution, provisioning, trusted workers, foreign-reference validation | Separate non-owner role; explicit system policies allow cross-business DML; no DDL, role creation, TRUNCATE or BYPASSRLS |
| `TENANT_DATABASE_URL` | Bound business queries and transactions | Separate non-owner role; business policies, no membership in system/owner roles, no DDL, TRUNCATE or BYPASSRLS |
| `RLS_ADMIN_DATABASE_URL` | One-time role/policy setup | PostgreSQL administrator; remove from application environment after setup |

The server needs a trusted system connection to locate an account or QR token
before the business is known. This is a privileged capability, not a tenant API.
Compromise of server secrets or arbitrary execution of server code is outside the
RLS tenant boundary. Keep migration and administrator credentials in deployment
jobs/separate secret scopes, not in the running production application. Prisma's
runtime datasource is explicitly overridden by `SYSTEM_DATABASE_URL`.
Set stable `OTP_SECRET` and `FEEDBACK_TOKEN_SECRET` before moving runtime credentials
or hosting; development's legacy fallback remains tied to the original database URL
so local role activation does not invalidate existing links.

## Existing local database activation

Do not reset the database. Stop the backend during the activation window. Supply
an administrator URL for the **same** host, port and database in ignored
`backend/.env` as `RLS_ADMIN_DATABASE_URL`. Do not paste it in chat or commit it.
The existing project role is not a role administrator and cannot create the new
runtime roles by itself.

From the project root, run in order:

```powershell
node backend/scripts/backup-postgres.mjs
cmd /c npm --prefix backend run prisma:deploy
cmd /c npm --prefix backend run rls:setup
cmd /c npm --prefix backend run test:rls
cmd /c npm --prefix backend run deploy:check
cmd /c npm run start:backend
```

The setup script creates `pos_tenant_runtime` and `pos_system_runtime` with random
passwords and saves only the two new runtime URLs to ignored root/backend `.env`
files. It does not change `DATABASE_URL` or the PostgreSQL provider. Passwords are
never printed. It refuses existing role names rather than silently replacing
their passwords or permissions. `RLS_RUNTIME_ROLE` and `RLS_SYSTEM_ROLE` can select
unused names. Remove the administrator variable after setup.

If setup fails, keep the backend stopped until the reported cause is resolved.
The migration retains an explicit policy for the table owner, so owner tooling
can still inspect/repair configuration. Do not fall back to owner credentials for
tenant queries. To restore service during an activation rollback, deploy the
previous application release using the existing owner connection and retain the
backup; arrange a reviewed rollback instead of deleting policies or resetting data.

## What PostgreSQL enforces

All 62 current models have enabled and forced RLS. Business records require a
matching business/tenant pair. Child records resolve their owner through parent
relations. JSON state, token/session records, job payloads, sync logs and document
sequences have explicit policies. Shared role/permission catalogues permit reading
definitions and materializing source-defined defaults, not arbitrary deletion.
Database triggers reject foreign-business record references on both application
runtime roles. Only owner/migration tooling can construct historical corruption.

Tenant operations run on the restricted connection. `set_config(..., true)` is set
inside the same transaction as the query, and is cleared by commit/rollback. Raw
SQL also goes through this connection. Callback transactions initialize the
context once and retain one connection, including row locks. The two previous
array-form tenant transactions were converted to callback form; new tenant code
must use callbacks. The application query guard remains as additional protection.

Runtime preflight checks reject owner/superuser/BYPASSRLS credentials, role or
database creation privileges, replication, owner-role membership, system-policy
access on a tenant connection, schema creation, TRUNCATE, and missing/unforced
policies. Production refuses missing runtime URLs. When RLS is configured, the
server verifies these checks before opening its HTTP listener or starting workers.

Future schema migrations must add RLS policies and explicitly grant the two
runtime roles access to new models. No blanket future-table grant is installed.
Review the generator output; do not modify already-applied migrations.

## Verification without touching existing data

```powershell
cmd /c npm --prefix backend run test:rls:isolated
```

This creates a disposable PostgreSQL cluster bound only to loopback, imports the
existing database's **schema only**, installs RLS and separate runtime roles, seeds
test data, and runs direct SQL tests and the full backend deployment checks.
It stops the temporary server on completion. Its files stay under ignored
`backend/data/rls-check-*`; no customer data is copied. Windows may need permission
to launch PostgreSQL outside the coding sandbox. `--quick` runs just the direct
database tests. An ordinary `deploy:check` also runs the RLS database tests whenever
`TENANT_DATABASE_URL` is configured.

Direct tests use an unextended Prisma client so application `where` filters cannot
mask a broken database policy. They cover absent/mismatched scope, direct and child
reads, raw SQL, writes, forged state keys, foreign references, role escape,
TRUNCATE/DDL denial, transaction rollback, concurrent tenants and pool context reuse.

Before public deployment, run these checks on staging, rehearse backup restoration,
verify HTTPS/public URLs and real secrets, and arrange independent security and
load testing. This implementation is not an independent security certification.

References: [PostgreSQL 18 row security](https://www.postgresql.org/docs/18/ddl-rowsecurity.html),
[Prisma v6 query extensions](https://www.prisma.io/docs/orm/v6/prisma-client/client-extensions/query).
