QR offers, feedback and service analytics

Where to use it

- Owners configure discounts under Happy Hours. Select QR, the appropriate outlets/items/categories and time window. The existing pricing engine chooses the best eligible base-item price; discounts do not stack.
- Guests see “Offers available now” on the QR menu when eligible, available items are discounted. The offer-only filter, original/current prices, cart offer names and savings all use the menu's actual prices. Sizes/extras are separate. Prices and availability are checked again on submission.
- Guests open Track this order → How was your visit? after the final linked invoice is paid. Overall rating is required; food/service ratings, topics and a comment are optional. Every rating is welcomed without reward or review gating.
- Staff open QR → Offers, feedback & analytics. Reports permission is required to read the report. Manager-view permission is required to save private review status/notes. Offer management retains its existing price-rules permission.

Feedback controls

The order tracking capability resolves the invoice and business; guest-supplied invoice/business/customer identifiers are not accepted. A paid, non-void/non-refunded bill is required for a new QR submission. Existing receipt feedback and QR feedback share the signed bill token. A per-bill transaction lock prevents duplicate simultaneous QR submissions; retries acknowledge the existing review. Existing receipt reviews also count as already submitted.

Overall/optional ratings are whole numbers 1–5, comments are at most 1000 characters, and topics come from the fixed food/speed/staff/cleanliness/value list. Extra scores and staff follow-up live in tenant-owned StateDocuments, keeping the existing Feedback model and receipt form compatible. Staff notes/status history never appear in guest responses. Saving a follow-up does not contact the guest.

Metric definitions

- Ranges cover inclusive UTC dates, at most 92 days. The report labels its timezone. Orders are grouped by placement date, requests by their recorded creation time, and reviews by submission date. Statuses reflect the current state of those records.
- Menu opens are recorded scan events, including repeats, using current table-to-outlet mappings. Background menu polling is excluded. Deleted QR scan events are not reconstructed. Opens are not unique guests or a conversion funnel; additional rounds are separate orders.
- Approval time is the median recorded placement-to-approval duration. Kitchen time is the median prep-start (or kitchen acceptance when absent) to ready duration. Invalid/missing timestamps do not become zero-minute samples. The sample count and completed prep times exceeding the stored prep target are shown.
- Assistance response is request-to-acceptance; resolution is request-to-completion. Closed or reopened sessions make unresolved old requests expired, not open/overdue. Existing pending/accepted attention thresholds are 2/5 minutes. All figures use requests created in the selected period.
- Offer use counts each accepted order once per applied rule and sums its units and recorded base-price savings in paise. Cancelled/rejected orders are excluded. These are ordered discounts, not collected revenue or profit.
- Rating averages exclude unrated responses. Ratings of 1–2 in overall, food or service need follow-up until resolved. The report shows up to 100 recent reviews; the attention filter separately retrieves up to 100 unresolved low-rating reviews so older complaints are not hidden behind newer reviews.
- The daily CSV exports dates and numeric order/request counts only. Comments and private follow-up notes are not exported by that button.

Verification

backend/scripts/qr-experience-tests.mjs exercises real HTTP/database flows with temporary fixture businesses: offer pricing and outlet eligibility, paid-only feedback, simultaneous retries, receipt parity, validation, permission/tenant/outlet boundaries, actual median durations, expired assistance, savings and private follow-up.

backend/scripts/rls-isolated-check.mjs --quick --experience runs those flows with forced RLS and restricted runtime roles in a disposable PostgreSQL cluster. Frontend QrExperience.test.js and QrServiceAnalytics.test.js cover offers, feedback retry preservation, private follow-up and late responses after switching outlets. Existing QR management, tracking, customization and public-route tests remain in the targeted regression set.

No new database migration, external messaging or production deployment is required/performed for this feature group.
