# CashFlow Lite POS Agent Guide

Read this file first before changing or debugging this project.

## Project Shape

- Root package starts both apps with `npm run dev`.
- Backend: `backend`, Express + Prisma, API port `4001`.
- Frontend: `frontend`, Create React App + CRACO, UI port `3002`.
- Main backend app entry: `backend/src/server.js`.
- Backend route registry: `backend/src/routes/module-registry.js`.
- Frontend routes/layout: `frontend/src/App.js` and `frontend/src/core/navigation/config/appNavigation.js`.
- Prisma schema: `backend/prisma/schema.prisma`.

## Current Local Database

- PostgreSQL 18 is installed locally.
- Current project DB URL is stored in ignored env files, not committed.
- Local database currently used by the project:

```txt
postgresql://viswa_pos_user:viswa_pos_password@localhost:5432/viswa_pos?schema=public
```

- Prisma provider is currently `postgresql`.
- Do not switch back to SQLite unless the user explicitly asks.
- If Prisma says a table/column is missing, check schema/migration mismatch first.

## Important Local Env Files

- Root `.env` is used by the backend loader.
- `backend/.env` is also present for Prisma CLI commands from the backend folder.
- Both are gitignored and may contain local secrets.
- Do not commit `.env`, `backend/.env`, DB files, logs, or build output.

## Default Credentials

```txt
owner@pos.com
admin123
```

Seed file:

```txt
backend/prisma/seed.js
```

## Start Commands

Use `cmd /c` on Windows if PowerShell blocks `npm.ps1`.

```powershell
cd "C:\Users\viswa\OneDrive\Desktop\viswa pos table error"
cmd /c npm run dev
```

Backend only:

```powershell
cmd /c npm run start:backend
```

Frontend only:

```powershell
cmd /c npm run start:frontend
```

## Port Conflicts

The project uses:

```txt
Backend: 4001
Frontend: 3002
AdminCore backend: 8000
AdminCore frontend: 3001
```

Check ports:

```powershell
netstat -ano | findstr ":4001 :3002"
```

Stop only the exact conflicting PIDs:

```powershell
taskkill /PID PASTE_PID_HERE /F
```

## Verification Commands

Backend syntax:

```powershell
node --check backend\src\server.js
```

Prisma:

```powershell
cmd /c npm --prefix backend run prisma:validate
cmd /c npm --prefix backend run prisma:generate
```

Backend smoke/deploy check:

```powershell
cmd /c npm --prefix backend run deploy:check
```

Frontend build:

```powershell
cmd /c npm --prefix frontend run build
```

## Database Commands

Enter psql:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U viswa_pos_user -d viswa_pos -h localhost
```

Useful psql commands:

```sql
\l
\dt
\d "User"
SELECT email, name, active FROM "User";
\q
```

If migrations fail because Postgres user lacks schema permission, run as `postgres`:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -d viswa_pos -c "GRANT USAGE, CREATE ON SCHEMA public TO viswa_pos_user; ALTER SCHEMA public OWNER TO viswa_pos_user;"
```

## Common Failure Patterns

- `EADDRINUSE :4001` or `:3002`: old backend/frontend is still running.
- `Cannot find react-refresh`: frontend dependencies are incomplete; run `cmd /c npm --prefix frontend install`.
- `PrismaClient is not defined`: check `backend/prisma/seed.js` imports `PrismaClient`.
- `type DATETIME does not exist`: SQLite migration SQL is being applied to Postgres.
- `P2021 table does not exist`: DB schema does not match Prisma schema. Check migrations first.
- Red React runtime overlay with 401/403/404/500: inspect the failing API endpoint, auth role, and backend route before changing UI.
- Login invalid after DB switch: verify seed data in Postgres and confirm backend is reading the intended `.env`.

## Core Backend Modules

- Auth: `backend/src/core/auth`
- Businesses/AdminCore sync: `backend/src/core/businesses`, `backend/src/core/admincore`, `backend/src/core/sync`
- Outlets: `backend/src/core/outlets`
- Products/menu: `backend/src/core/products`
- Billing/orders: `backend/src/core/billing`, `backend/src/core/orders`
- KOT/kitchen: `backend/src/features/kitchen/kot`
- QR ordering/table management: `backend/src/features/sales-extensions/qr-ordering`, `backend/src/features/sales-extensions/table-management`
- Reports: `backend/src/core/reports`
- Inventory: `backend/src/core/inventory`
- Printer/payment foundations: `backend/src/core/printer`, `backend/src/core/payments`

## Frontend Areas

- Auth/session: `frontend/src/contexts/AuthContext.js`, `frontend/src/lib/sessionSlots.js`
- Active outlet state: `frontend/src/core/outlets/store/ActiveOutletContext.jsx`
- Dashboard: `frontend/src/pages/Dashboard.js`
- Billing: `frontend/src/pages/Billing.js`
- QR management/menu: `frontend/src/pages/QrManagement.js`, `frontend/src/pages/QrOrdering.js`
- Chef/waiter: `frontend/src/pages/Chef.js`, `frontend/src/pages/Waiter.js`
- Products: `frontend/src/pages/Products.js`
- Reports: `frontend/src/pages/Reports.js`
- Reservations/planner: `frontend/src/pages/ReservationPlanner.js`

## AdminCore Link

AdminCore project path:

```txt
C:\Users\viswa\OneDrive\Desktop\pos admin panel - Copy\pos admin panel not 1drive
```

POS exposes these AdminCore-facing routes:

```txt
GET /api/admincore/connection
GET /api/admincore/health
GET /api/businesses
GET /api/sync/export/businesses
GET /api/sync/export/outlets
GET /api/sync/export/products
GET /api/sync/export/orders
GET /api/sync/export/staff
GET /api/sync/export/inventory
GET /api/sync/export/tables
GET /api/sync/export/reservations
GET /api/sync/logs/admincore
```

Do not edit the AdminCore project from this repo unless the user explicitly asks and grants permission.

## Deployment

- Render backend config: `render.yaml`.
- Vercel frontend config: `frontend/vercel.json`.
- Deployment instructions: `DEPLOYMENT.md`.
- For production Render/Vercel, set real public URLs in:

```txt
CORS_ORIGINS
POS_BASE_URL
QR_PUBLIC_BASE_URL
REACT_APP_BACKEND_URL
REACT_APP_PUBLIC_FRONTEND_URL
```

## Working Rules For Agents

- Before changing code, reproduce or identify the exact failing endpoint/component.
- Prefer focused fixes over broad rewrites.
- Do not remove routes or modules just because they appear unused.
- Keep outlet and tenant concepts intact; this is a SaaS/multi-business POS.
- Preserve current architecture unless the user asks for a larger refactor.
- Use `rg` for searching.
- Use `apply_patch` for manual edits.
- Do not run destructive DB reset/migration commands without explicit approval.
- Do not change Prisma provider or `DATABASE_URL` without explicit approval.
- Run relevant checks before claiming a fix is complete.
