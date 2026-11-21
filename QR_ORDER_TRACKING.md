QR order tracking and additional rounds

- Guests can track sent, accepted, preparing, ready and served stages. Rejected/cancelled orders stop the timeline. Kitchen ticket status takes priority over billing status.
- Temporary connection failures retain the last received order and retry every five seconds while the page is visible; returning to the page refreshes immediately.
- “Your orders this visit” stores only this browser tab's order IDs and tracking links in session storage, scoped by QR token, table session and seating start time. It does not list other guests' orders. Storage-disabled browsers can still order and follow the immediate tracking link.
- Tracking pages opened from this browser offer “Add another round / return to menu”. Each round is a separate order in the active table session; it does not modify an already sent order or charge a payment.
- Uncertain submissions retain an idempotency key in session storage. Retrying identical details reuses it; successful submission clears it. The server serializes duplicate submissions by QR and request key.
- New clients send the session key and opening time. Closed or reopened visits reject stale submissions and ask the guest to scan again. Older clients remain compatible without these fields.

Verification: backend/scripts/qr-progress-tests.mjs exercises real public HTTP routes using a disposable fixture business. Frontend QrOrderTracking.test.js checks outage recovery and cumulative kitchen progress; qrVisit.test.js checks seating separation and retry persistence.
