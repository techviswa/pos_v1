# QR table service

Guests open a table's QR menu and use **Call waiter**, **Table assistance**, or
**Request bill**. Assistance includes water, cutlery, tissues, cleaning, an extra
chair and a short custom request. Bill requests collect a cash/card/UPI preference;
they do not generate an invoice or charge a payment.

Waiter and Manager screens contain **Table service requests**. Staff take a request
and mark it completed. Managers can assign/reassign eligible staff from the same
business and outlet. Existing screen permissions (`waiter_view` / `manager_view`)
control access; assignment never grants permissions. The guest sees request sent,
someone is coming, and completed. Guest status checks run every five seconds while
the page is visible. Staff use existing realtime events with a ten-second polling
fallback. Sound is optional and must be enabled by clicking **Enable sound**.

Pending requests older than two minutes, and accepted requests older than five
minutes, appear as **Needs manager attention** in the queue. This is an on-screen
escalation; it does not send SMS or browser push notifications outside the app.
Request history records who accepted, assigned and completed each request.

Requests persist as business-owned `StateDocument` records under
`assistance:<business>:<request UUID>`, using the existing JSON ownership/RLS policies.
No new schema migration is required. Tokens are resolved server-side; a request's
business, table and outlet cannot be selected through its body. Session ownership
and active status are validated, and private staff actions check outlet access.
Public status responses omit staff identities, private notes and audit details.
Tables assigned to an outlet route to staff with access to that outlet. Legacy
tables without an outlet remain visible to unrestricted managers in the all-outlets
queue; configure their table/outlet mapping before assigning outlet-limited waiters.

Concurrent taps reuse the open request for that assistance type. A table can send
at most eight new requests in five minutes; repeating a completed type has a
30-second cooldown. Closed/reopened sessions expire older open requests, which
remain in staff history. Rotated/deleted QR tokens cannot create or read requests.

Checks:

```powershell
node backend/scripts/table-assistance-tests.mjs
node backend/scripts/rls-isolated-check.mjs --quick --assistance
cmd /c npm --prefix frontend test -- --watchAll=false --runInBand --runTestsByPath src/components/QrTableAssistance.test.js src/components/TableAssistanceInbox.test.js
node backend/scripts/qr-browser-check.mjs --assistance
```

HTTP tests use temporary businesses and clean up their records. The browser check
renders existing tables and staff screens without sending artificial service calls
to the live business. PostgreSQL administrator access is still required to activate
the separate runtime roles on the existing local database; see `RLS_DEPLOYMENT.md`.
