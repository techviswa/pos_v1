# CashFlow Lite POS Deployment

Production deployment requires resolving the configuration blockers below.
Install the RLS migration and separate runtime roles following
[RLS_DEPLOYMENT.md](RLS_DEPLOYMENT.md); production now requires both runtime URLs
and verifies the database privileges before accepting HTTP requests.

- Frontend: Vercel, using the `frontend` directory.
- Backend: Render Web Service, using `render.yaml`.
- Database: Prisma and the Render Blueprint use PostgreSQL. Set `DATABASE_URL` to the intended production PostgreSQL database. The Blueprint requests the Starter service plan; this local configuration does not upgrade or deploy an existing service by itself.
- Automatic demo seeding has been removed from the build. With `NODE_ENV=production`, the seed runs access-control defaults only.
- AdminCore notifications use a PostgreSQL-backed job queue and sync history. AdminCore receives events into its MongoDB-backed worker queue. Both services must run their workers and share the configured bridge credentials.
- The backend build runs dependency installation and Prisma generation. The pre-deploy command applies migrations and seeds access-control defaults only. Render uses `/health/ready` to check database schema availability before accepting the release; `/health` checks only whether the HTTP server responds.

## 1. Backend on Render

### Account email

Configure `SMTP_HOST`, `SMTP_PORT` (587 with STARTTLS or 465 with TLS), `SMTP_FROM`, `SMTP_USER`, `SMTP_PASSWORD`, and `AUTH_PUBLIC_URL` (the HTTPS POS frontend origin). Reset emails link to `/reset-password?token=...`; invitations link to `/invite/...`. These values belong only in backend secret configuration. Production password-reset requests return 503 when email configuration is absent, rather than silently creating undeliverable tokens. Staff invitation responses retain a copyable link, and also send email when configured. SMTP acceptance is not proof of inbox delivery; verify the sender domain and delivery with your mail service before release.

### Nightly off-site backup (built in)

The backend backs up the whole database every night (BACKUP_HOUR, default 03:00 Asia/Kolkata) to any S3-compatible bucket: the snapshot is consistent (one REPEATABLE READ transaction), compressed and encrypted with AES-256-GCM, uploaded, downloaded again and verified table by table; 30 daily and 12 monthly copies are kept (BACKUP_KEEP_DAILY / BACKUP_KEEP_MONTHLY). Settings shows the real last backup to owners, and owners can download their own business data there.

Set on Render: BACKUP_S3_ENDPOINT (R2: https://<account>.r2.cloudflarestorage.com; B2: its S3 endpoint; empty for AWS), BACKUP_S3_REGION (auto for R2), BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY and BACKUP_ENCRYPTION_KEY (your own random 32+ character secret). Keep a copy of BACKUP_ENCRYPTION_KEY outside Render (password manager): without it no backup can be restored. Give the storage key access to that bucket only.

Commands (backend/): `npm run backup:now` (take and verify one now), `npm run backup:restore -- --list`, `npm run backup:restore -- --name <file> --target "<empty database URL>"` (target must have the same migrations applied: `DATABASE_URL=<target> npx prisma migrate deploy`; the script refuses a non-empty target and the live database), `npm run backup:drill` (backs up, restores into a temporary schema with all foreign keys, compares every table, drops the schema). Run a drill after each schema change and at least monthly.

### PostgreSQL backup (manual, pg_dump)

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

## 7. Razorpay at the till (each restaurant's own account)

Needs `POS_PUBLIC_API_URL` (public https URL of this API) and the encryption key above (`SECRETS_ENCRYPTION_KEY`, or
`MARKETING_ENCRYPTION_KEY` when unset; never change it once keys are stored).

1. The restaurant Owner opens **Settings > Razorpay** and enters the Key ID and Key Secret from Razorpay Dashboard >
   Account & Settings > API keys. The keys are checked with Razorpay before Razorpay can be switched on.
2. Press **Create webhook secret**, then in Razorpay Dashboard > Webhooks add the webhook URL shown on that screen
   (`https://API/api/public/payments/razorpay/webhook/<key>`) with that secret and the events listed there
   (payments, QR codes, payment links and refunds).
3. Test with Razorpay test keys first: take a UPI (QR) and a Card (link) payment, refund one from **Bills**.

Without a webhook the till still confirms by asking Razorpay every few seconds while the payment screen is open.

## 8. Plan & Billing: charging restaurants (Taskoora's Razorpay account, on AdminCore)

Set on the AdminCore backend: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`. Enable
Subscriptions on the Razorpay account. Add a Razorpay webhook to `https://ADMINCORE-API/api/billing/razorpay/webhook`
with the same secret and the events `subscription.activated`, `subscription.charged`, `subscription.resumed`,
`subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.completed`, `subscription.cancelled`.

The POS must reach AdminCore: `ADMINCORE_ENABLED=true`, `ADMINCORE_API_BASE_URL`, and the same `ADMINCORE_API_KEY`
(32+ characters) on both services. Owners pay on **Plan & Billing**; a business whose retries all fail becomes
read-only (data kept) until paid.

## 9. Error alerts (Sentry)

Create one Sentry project per app and set the DSN:

```txt
POS backend (Render):        SENTRY_DSN, SENTRY_ENVIRONMENT=production
AdminCore backend (Render):  SENTRY_DSN, SENTRY_ENVIRONMENT=production
POS frontend (Vercel):       REACT_APP_SENTRY_DSN, REACT_APP_SENTRY_ENVIRONMENT=production
AdminCore frontend (Vercel): REACT_APP_SENTRY_DSN, REACT_APP_SENTRY_ENVIRONMENT=production
```

Leaving a DSN empty turns reporting off. Only server faults (5xx) and browser crashes are sent; tokens, cookies,
emails, phone numbers, request bodies and secret URL keys are removed first. Redeploy Vercel after setting the DSN.
