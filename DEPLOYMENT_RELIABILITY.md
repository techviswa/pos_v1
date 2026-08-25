# Deployment and Reliability Notes

This phase intentionally does not change `DATABASE_URL` or the Prisma datasource provider. Postgres conversion is a separate handoff task.

## What is now available

- `npm run test:smoke` runs bounded backend API smoke tests without starting the normal long-running dev server.
- `npm run deploy:check` runs backend syntax checks, Prisma validation, and smoke tests.
- `GET /health/jobs` reports the in-memory background job worker state.
- `backend/logs/errors.jsonl` receives backend exception/monitoring events when errors happen.
- `POST /api/printer` queues virtual print jobs for receipt/KOT/printer service integration.
- `GET /api/sync/strategy` documents the current offline/sync strategy.
- Products, orders, billing, and inventory list APIs now have pagination defaults and caps.

## Postgres handoff for friend

Do not change this casually in the app code. The Postgres work should be done as a controlled deployment task:

1. Create production Postgres database and user.
2. Set production `DATABASE_URL` in the deployment environment.
3. Confirm Prisma datasource provider and migration history.
4. Run `npm --prefix backend run prisma:validate`.
5. Run `npm --prefix backend run prisma:deploy`.
6. Run `npm run test:smoke` against the production-like environment.
7. Confirm backup and restore commands before onboarding real clients.

## Production gaps still requiring real infrastructure

- Error monitoring currently writes local JSONL hooks; connect this to Sentry, OpenTelemetry, or another monitoring backend later.
- Background jobs are in-memory; move jobs to a durable queue before multi-server production.
- Printer jobs are abstracted; a real local/network printer agent must consume and acknowledge them.
- Offline sync accepts client event buffers; real conflict resolution needs record versioning and durable sync tables.
