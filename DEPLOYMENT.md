# CashFlow Lite POS Deployment

This repo is prepared for a low-cost showcase deployment:

- Frontend: Vercel, using the `frontend` directory.
- Backend: Render Web Service, using `render.yaml`.
- Database: still SQLite for now because the project owner asked not to change `DATABASE_URL` or the Prisma provider. Treat this as demo-only until the Postgres handoff is completed.

## 1. Backend on Render

Create a Render Blueprint from this GitHub repo. Render reads `render.yaml` from the repo root and deploys the backend from `backend`.

Set these Render environment variables after the service is created:

```txt
ADMIN_PASSWORD=admin123
CORS_ORIGINS=https://YOUR-VERCEL-FRONTEND.vercel.app,http://localhost:3002,http://localhost:3001
POS_BASE_URL=https://YOUR-RENDER-BACKEND.onrender.com
QR_PUBLIC_BASE_URL=https://YOUR-VERCEL-FRONTEND.vercel.app
ADMINCORE_ENABLED=false
ADMINCORE_API_BASE_URL=
ADMINCORE_API_KEY=
ADMINCORE_SYNC_WEBHOOK_URL=
```

Keep `ADMINCORE_ENABLED=false` for a public demo unless your AdminCore backend is also deployed and reachable.
When AdminCore is live, set `ADMINCORE_ENABLED=true`, point `ADMINCORE_API_BASE_URL` to AdminCore, and optionally set `ADMINCORE_SYNC_WEBHOOK_URL` to AdminCore's POS bridge receiver. If the webhook URL is blank, the POS backend uses `/api/pos-bridge/sync-status` on the AdminCore base URL.

Backend health URL:

```txt
https://YOUR-RENDER-BACKEND.onrender.com/health
```

## 2. Frontend on Vercel

Import the same GitHub repo into Vercel and set:

```txt
Root Directory: frontend
Framework: Create React App
Build Command: npm run build
Output Directory: build
Install Command: npm ci
```

Set these Vercel environment variables:

```txt
REACT_APP_BACKEND_URL=https://YOUR-RENDER-BACKEND.onrender.com
REACT_APP_PUBLIC_FRONTEND_URL=https://YOUR-VERCEL-FRONTEND.vercel.app
GENERATE_SOURCEMAP=false
```

After changing frontend env values, redeploy the Vercel project.

## 3. QR phone scanning

QR links must use the public frontend domain:

```txt
https://YOUR-VERCEL-FRONTEND.vercel.app/qr/YOUR_TABLE_QR_TOKEN
```

The backend env `QR_PUBLIC_BASE_URL` should match the Vercel frontend URL so generated QR codes do not point to localhost.

## 4. Postgres handoff notes

Do this only when ready for production database work:

```txt
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

Then update `backend/prisma/schema.prisma` datasource provider from `sqlite` to `postgresql`, regenerate Prisma migrations, run migration deploy, seed only safe default data, and re-run the API smoke tests.

## 5. Verification checklist

```txt
Backend /health returns 200
Frontend opens on Vercel URL
Login works
Products load
Billing loads
QR menu opens from public Vercel URL
AdminCore link remains disabled unless a real AdminCore URL is configured
```
