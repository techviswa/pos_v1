# Taskoora security & production register

Living list for both projects. Verify with `cmd /c npm --prefix backend run deploy:check` (POS) and
`python -m unittest discover -p "test_*.py"` in the AdminCore `backend` folder. Browser check (installed Chrome):
`node backend/scripts/mobile-viewport-tests.mjs` from the POS root after `npm --prefix frontend run build`.

## Done

**AdminCore (FastAPI/Mongo)**
- Login lockout (per email and email+IP, Mongo-backed), constant-time password check, failed logins audited.
- Session revocation (`token_version`): logout, password/role/status/business change, MFA reset end old sessions.
- Sessions are httpOnly cookies only (no tokens in `localStorage` or JSON bodies); cookie-authenticated writes need the
  `X-Requested-With` header (CSRF). `vercel.json` proxies `/api` so cookies are first-party (Safari-safe).
- TOTP MFA with recovery codes; mandatory for platform staff when `REQUIRE_PLATFORM_MFA=true`.
- Internal RBAC: Super Admin, Operations, Finance, Security, Auditor; permission-checked, hierarchy-enforced.
- Customers cannot set their own plan/status/subscription; business count limited by plan (`businesses.max`).
- Suspension/subscription changes need reasons, are audited before/after and are pushed to the POS first.
- Optional automatic subscription expiry (`SUBSCRIPTION_AUTO_EXPIRY=off|trials|all`, `SUBSCRIPTION_GRACE_DAYS`).
- CORS without wildcard, no self-registration in production, no demo seeding in production, security headers.

**POS (Express/Prisma/PostgreSQL)**
- Rate limits: login, password reset/change, invites; public reads (generous, shared Wi-Fi safe) and writes (tight).
- Privilege escalation closed; last-owner protection; own password change needs the current password.
- Tenant isolation across businesses, features, logistics, feedback, legacy state, QR outlet, sync logs.
- Outlet-level access: staff assigned to outlets only see/act on those outlets (lists, records, reports, live events).
- Every read route has a permission guard (bills, reservations, tables, analytics, central kitchen, barcode, batches).
- Same email in several businesses: login asks which business; reset sends one link per account.
- Subscription lifecycle enforced (suspended blocked, expired/cancelled read-only, never deleted).
- Money stored as exact `DECIMAL` (prices/totals 12,2; costs 18,6); returned to code as numbers in one place.
- Database guarantees: unique invoice number per business, one kitchen ticket per order, billed orders not deletable.
- Server-side pricing, quantity/GST/discount validation, idempotent bills/payments/refunds/QR orders, overselling
  refused atomically, order lifecycle rules, forged metadata dropped.
- Payment intents tied to the bill's outstanding amount; confirming one confirms the bill payment (manager + ref).
- QR: inbox to approve/reject orders (was missing), reject only while pending, SMS verification (Twilio or webhook),
  hashed/rate-limited codes in the database.
- Real-time: Server-Sent Events over PostgreSQL NOTIFY (commit-only, multi-instance), single-use stream tickets,
  outlet-scoped; kitchen, waiter, manager, owner, billing, bills and reservations screens refresh live.
- Offline till: reload-safe offline selling (see limits below); bills sync once each, refused ones wait for review.
  Browser checks: `npm --prefix backend run test:browser` (needs a frontend build and installed Chrome).
- Menu depth: choice groups (min/max enforced on the server), combos (component stock and recipes deducted),
  per-outlet price/availability (`OutletProduct`), per-channel prices, happy hours (`/api/price-rules`, Owner/Manager
  edit). One price engine (`backend/src/core/menu/menu-pricing.js`) prices billing, orders and QR alike; clients
  cannot set prices. Tests: `backend/scripts/menu-depth-tests.mjs` (part of deploy:check).
- Per-screen permissions: every screen has a key (`access.constants.js`); Waiter/Chef/Manager/QR/Reservations screens
  and their APIs no longer check the role name. Manager authority (refunds, void approval, payment confirmation, open
  prices, large discounts) stays tied to the role. Someone given the Staff screen without being a Manager may only
  manage Waiter/Chef/Cashier accounts and only grant screens they hold. Migration `20260930160000_staff_attendance_tips`
  gave existing accounts the screen keys their role already opened.
- Attendance (`/api/attendance`): clock in/out and breaks (one open shift per person, enforced under a lock), shared
  PIN clock (hashed PINs, 5 wrong tries lock for 15 minutes), manager corrections need a reason and keep before-values;
  nobody but an Owner changes their own hours; shifts are soft-deleted.
- Tips (`/api/tips`): taken with the bill (never taxed), from QR orders, or declared; count once the bill is paid and
  drop out if it is voided/refunded; pool shared by hours worked; payouts re-checked against the balance under a lock,
  idempotent, and periods may not partly overlap. Shift swaps are now stored in the database.
  Tests: `backend/scripts/staff-features-tests.mjs` (part of deploy:check).
- Customers & loyalty (`/api/customers`): one profile per phone per business (phone formats normalised); points ledger
  whose sum is the balance; points earned only on fully paid bills, taken back on refund/void, redeemed points returned
  on void/full refund; soonest-expiring points are spent first; replayed bills never double-count. Erasure on request
  (Owner/Manager) removes personal data and forfeits points but keeps bill amounts. Migration
  `20260930180000_customers_loyalty_giftcards_payroll` built profiles from existing bills (those bills never earn points).
- Gift cards: 16-character random codes (the full code is shown once at sale, masked everywhere else and never stored
  on bills); balance changes only via transactions under a per-card lock; UPI/card sales wait for manager confirmation;
  cash sales/payouts are in the cash-drawer report; card payments are confirmed server-side; refunds go back only up
  to what the card paid.
- Payroll (`/api/payroll`, Owner-only by default): payslips from pay profile + attendance; PF/ESI/PT/overtime/LOP;
  finalising freezes figures and requires no open shifts; nobody but an Owner edits their own pay; staff see only
  their own finalised payslips; only the last 4 bank digits are stored. Tests: `customers-payroll-tests.mjs`.
- Marketing (`/api/marketing`, Owner-only by default): each business's WhatsApp (Meta Cloud API) and SMS (MSG91 /
  Twilio / own gateway) credentials are AES-256-GCM encrypted with `MARKETING_ENCRYPTION_KEY` and never returned.
  Only guests with recorded consent are messaged; STOP/UNSUBSCRIBE (WhatsApp or SMS) withdraws it immediately and
  drops queued messages; sending only inside the window (never outside 09:00-21:00) and at most N per guest per week,
  re-checked at send time under a per-guest lock. WhatsApp callbacks require a valid X-Hub-Signature-256; SMS callbacks
  a per-business secret URL key. Phone numbers are masked in reports. Tests: `marketing-tests.mjs`.
- Migrations verified: all 16 apply cleanly to an empty database and match `schema.prisma` exactly. The local
  database is baselined, so `npm --prefix backend run prisma:deploy` works for future migrations.

## Production configuration
POS: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGINS`, `ADMINCORE_API_KEY` (>= 32), `FEEDBACK_TOKEN_SECRET`, `OTP_SECRET`,
`MAX_STAFF_DISCOUNT_PERCENT` (default 30), SMS: `SMS_PROVIDER=twilio` + `TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM`
or `SMS_PROVIDER=webhook` + `SMS_WEBHOOK_URL` (HTTPS) [+ `SMS_WEBHOOK_TOKEN`], `SMS_COUNTRY_CODE` (default +91).
AdminCore: `JWT_SECRET` (>= 32), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (>= 12, first boot), `MFA_ENCRYPTION_KEY`,
`REQUIRE_PLATFORM_MFA`, `TRUST_PROXY_HEADERS`, `ALLOW_SELF_REGISTRATION`, `COOKIE_SAMESITE` (`lax` when proxied),
`EXPOSE_TOKENS_IN_BODY` (only for non-browser integrations), `SUBSCRIPTION_AUTO_EXPIRY`, `SUBSCRIPTION_GRACE_DAYS`.
Frontend (AdminCore): leave `REACT_APP_BACKEND_URL` unset on Vercel so `/api` goes through the same-origin rewrite.

## Deliberate limits (not bugs)
- Offline till: a cashier already signed in on a tab can reload and keep taking cash/due bills for up to 24 hours
  without a connection (app shell cached by a service worker; menu and outlets copied per user and wiped at logout).
  Signing in on a new tab, card/UPI payments and the kitchen screen need the connection; offline receipts say to hand
  the printed copy to the kitchen. Stock of unsynced sales is held back on that till only, so another till can still
  sell the same units; the server refuses oversold bills at sync and they wait for review.
- Happy hours change the item's base price only; add-ons and choices keep their price. When several rules match,
  the lowest price wins (no stacking). Each rule chooses its channels (QR, dine-in, takeaway, delivery; none = all).
  Offline bills are priced at the time they were taken, not the time they sync.
- Tips: payouts and balances are business-wide (an outlet filter shows earnings only). Cash tips collected with bills sit
  in the drawer as sales (the drawer report shows them) until paid out. Payroll/wages and statutory filings are not built.
- Loyalty points are a discount before GST; gift card sales are not taxed (GST on redemption, per CBIC's voucher
  clarification). Confirm both with the business's accountant. No WhatsApp/SMS marketing sends yet (needs Meta/DLT).
- Marketing needs each business's own Meta-approved WhatsApp templates and DLT-registered SMS templates; the system
  references them but cannot register or approve them. Frontend build tooling (Create React App) still reports
  audit findings that only a move to Vite would clear; they are build-time only and do not ship to browsers.
- Payroll does not file PF (ECR), ESI, PT or TDS returns and does not compute income tax; TDS is entered as a line.
- Automatic expiry of paid periods is off until renewals are recorded; enabling `all` early would lock paying tenants.
- No payment-gateway webhook yet: UPI/card confirmations are manual (manager + transaction reference).
- Staff with no outlet assignment keep business-wide access (single-outlet businesses rely on this).
