# CashFlow Lite POS Deployment

Production deployment requires resolving the configuration blockers below:

- Frontend: Vercel, using the `frontend` directory.
- Backend: Render Web Service, using `render.yaml`.
- Database: Prisma and the Render Blueprint use PostgreSQL. Set `DATABASE_URL` to the intended production PostgreSQL database. The Blueprint requests the Starter service plan; this local configuration does not upgrade or deploy an existing service by itself.
- Automatic demo seeding has been removed from the build. With `NODE_ENV=production`, the seed runs access-control defaults only.
- AdminCore notifications use a PostgreSQL-backed job queue and sync history. AdminCore receives events into its MongoDB-backed worker queue. Both services must run their workers and share the configured bridge credentials.
- The backend build runs dependency installation and Prisma generation. The pre-deploy command applies migrations and seeds access-control defaults only. Render uses `/health/ready` to check database schema availability before accepting the release; `/health` checks only whether the HTTP server responds.

## 1. Backend on Render

### Account email

Configure `SMTP_HOST`, `SMTP_PORT` (587 with STARTTLS or 465 with TLS), `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, and `AUTH_PUBLIC_URL` (the HTTPS POS frontend origin). Reset emails link to `/reset-password?token=...`; invitations link to `/invite/...`. These values belong only in backend secret configuration. Production password-reset requests return 503 when email configuration is absent, rather than silently creating undeliverable tokens. Staff invitation responses retain a copyable link, and also send email when configured. SMTP acceptance is not proof of inbox delivery; verify the sender domain and delivery with your mail service before release.

### PostgreSQL backup

Run `node backend/scripts/backup-database.mjs` from the repository root with the intended database configured in the backend environment. It creates a uniquely named custom-format `pg_dump` archive in ignored `backend/data/backups/` and checks its table-of-contents using `pg_restore --list`. PostgreSQL client tools must be installed. Database credentials are passed through the child environment, not command arguments.

These archives contain private business data. Store production copies in access-controlled storage outside the application host and define retention appropriate to the business. Archive inspection is not a restore test: restore into an isolated database and validate row counts and core flows before relying on the process. The script does not automatically restore, delete old backups, or schedule production backups.

Create a Render Blueprint from this GitHub repo. Render reads `render.yaml` from the repo root and deploys the backend from `backend`.

Set these Render environment variables after the service is created:

```txt
ADMIN_PASSWORD=SET_A_UNIQUE_STRONG_SECRET
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

## 4. PostgreSQL deployment gate

With explicit approval to update the deployment database configuration, set the following in Render (never commit the real URL):

```txt
DATABASE_PROVIDER=postgresql
DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

The Prisma provider already is PostgreSQL. Do not regenerate or rewrite applied migrations. Run `npm run prisma:deploy` against the intended database and verify `/health/database` returns 200 with empty `missing_tables` and `missing_columns`. This checks table/column presence, not types, indexes, constraints, or migration history. Review `prisma migrate status` separately. Never reset a production database.

Before migrations, take a PostgreSQL custom-format backup using `pg_dump --format=custom --file=pos-backup.dump` with connection settings supplied securely through PostgreSQL environment variables. Store backups encrypted outside the service filesystem, restrict access, define retention, and rehearse restoring to a separate database with `pg_restore`. Do not commit dumps. A scheduled backup job and verified recovery procedure are still deployment requirements.

The Blueprint specifies the Starter plan. Verify the existing service's plan in the hosting dashboard; changing this file does not upgrade an existing service by itself.

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

## 6. Marketing: WhatsApp and SMS

Each business connects its own accounts on **Marketing > Accounts & rules**. The server needs `MARKETING_ENCRYPTION_KEY`
(32+ characters, generated by `render.yaml`) and `POS_PUBLIC_API_URL` (the public https URL of this API).

WhatsApp (Meta Cloud API):
1. In Meta Business Manager create a WhatsApp Business Account and add the restaurant's phone number.
2. In the Meta developer app: copy the **Phone number ID**, create a **permanent System User access token** with
   `whatsapp_business_messaging`, and copy the **App secret** (App settings > Basic). Enter all three and switch WhatsApp on.
3. Webhooks: callback URL and verify token are shown on the Marketing screen. Subscribe to the `messages` field.
   This delivers delivery/read receipts and STOP replies.
4. Create marketing templates in WhatsApp Manager. Once Meta approves them, add each one on the Templates tab
   with the exact name, language and text ({{1}}, {{2}}...).

SMS (India requires DLT):
1. Register the business (entity/PE ID), a sender ID (header) and each promotional content template on a DLT portal
   (Jio, Airtel, Vi...). Use {#var#} for variables and include an opt-out line.
2. Choose MSG91, Twilio, or your own gateway (webhook). Enter the credentials, sender ID and entity ID.
3. On the Templates tab, add each DLT template with its DLT template id (and the MSG91 template id for MSG91).
4. In the provider's panel, point delivery reports and inbound replies at the two SMS URLs shown on the Marketing screen.

Rules enforced by the server: only guests who agreed to offers; replying STOP opts out immediately; promotions are
sent only between 09:00 and 21:00 (default 10:00-21:00, as TRAI requires for promotional SMS); at most N per guest per week.
Set `MARKETING_WORKER=off` on extra instances only if you want a single sender (several instances are also safe).
